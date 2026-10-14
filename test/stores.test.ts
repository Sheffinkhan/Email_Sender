import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore, parseSettings, SettingsError } from '../src/settings.js';
import { createTemplateStore, normaliseTemplate, slugify, TemplateError } from '../src/templateStore.js';

const INPUT = {
  host: 'SMTP.Titan.Email',
  port: '465',
  user: ' info@acme.test ',
  password: 'not-a-real-password',
  fromName: ' Acme ',
};
const SAVED = {
  host: 'smtp.titan.email',
  port: 465,
  user: 'info@acme.test',
  password: 'not-a-real-password',
  fromName: 'Acme',
};
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'email-sender-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('normaliseTemplate', () => {
  it('fills missing fields with empty text', () => {
    const template = normaliseTemplate({ name: 'Offer' });
    expect(template).toMatchObject({ id: '', name: 'Offer', heading: '', footer: '' });
  });

  it.each([
    ['not an object', null],
    ['a missing name', { name: '  ' }],
    ['a non-text field', { name: 'Offer', heading: 5 }],
    ['an over-long field', { name: 'x'.repeat(81) }],
    ['a path-like id', { name: 'Offer', id: '../secrets' }],
    ['a non-text id', { name: 'Offer', id: 7 }],
  ])('rejects %s', (_label, input) => {
    expect(() => normaliseTemplate(input)).toThrow(TemplateError);
  });
});

describe('slugify', () => {
  it('makes a file-safe id', () => {
    expect(slugify('  Spring Offer #2! ')).toBe('spring-offer-2');
  });
});

describe('template store', () => {
  it('saves, lists, reads and removes templates', async () => {
    const store = createTemplateStore(path.join(dir, 'templates'));
    expect(await store.list()).toEqual([]);

    const saved = await store.save({ name: 'Welcome', heading: 'Hi {{name}}' });
    expect(saved.id).toBe('welcome');
    await store.save({ name: 'Autumn offer' });

    expect(await store.list()).toEqual([
      { id: 'autumn-offer', name: 'Autumn offer' },
      { id: 'welcome', name: 'Welcome' },
    ]);
    expect((await store.get('welcome'))?.heading).toBe('Hi {{name}}');

    expect(await store.remove('welcome')).toBe(true);
    expect(await store.remove('welcome')).toBe(false);
    expect(await store.get('welcome')).toBeUndefined();
  });

  it('keeps the section order', async () => {
    const store = createTemplateStore(dir);
    expect((await store.save({ name: 'Plain' })).order[0]).toBe('logo');
    await store.save({ name: 'Flipped', order: ['footer', 'heading'] });
    expect((await store.get('flipped'))?.order.slice(0, 3)).toEqual(['footer', 'heading', 'logo']);
  });

  it('updates in place when an id is given', async () => {
    const store = createTemplateStore(dir);
    const saved = await store.save({ name: 'Welcome' });
    await store.save({ ...saved, name: 'Welcome v2' });
    expect(await store.list()).toEqual([{ id: 'welcome', name: 'Welcome v2' }]);
  });

  it('picks a free id when saving a new template with a used name', async () => {
    const store = createTemplateStore(dir);
    await store.save({ name: 'Welcome' });
    expect((await store.save({ name: 'Welcome' })).id).toBe('welcome-2');
    expect((await store.save({ name: 'Welcome' })).id).toBe('welcome-3');
    expect((await store.save({ name: '!!!' })).id).toBe('template');
  });

  it('skips files that do not parse', async () => {
    const store = createTemplateStore(dir);
    await store.save({ name: 'Welcome' });
    await writeFile(path.join(dir, 'broken.json'), '{ not json');
    expect(await store.list()).toEqual([{ id: 'welcome', name: 'Welcome' }]);
    await expect(store.get('broken')).rejects.toThrow();
  });

  it('refuses ids that could leave the templates folder', async () => {
    const store = createTemplateStore(dir);
    await expect(store.get('../package')).rejects.toThrow(TemplateError);
    await expect(store.remove('..\\package')).rejects.toThrow(TemplateError);
  });
});

describe('settings', () => {
  it('tidies valid input', () => {
    expect(parseSettings(INPUT)).toEqual(SAVED);
    expect(parseSettings({ ...INPUT, port: 587, fromName: undefined })).toMatchObject({ port: 587, fromName: '' });
  });

  it.each([
    ['a missing address', { user: 'info' }, /full email address/],
    ['a server that is not a host name', { host: 'smtp.titan.email/x' }, /sending server/],
    ['an unencrypted port', { port: 25 }, /465 or 587/],
    ['an over-long name', { fromName: 'x'.repeat(81) }, /name is too long/],
    ['a missing password', { password: '' }, /Enter the password/],
    ['a non-text password', { password: 12345 }, /Enter the password/],
    ['an over-long password', { password: 'x'.repeat(501) }, /Password is too long/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => parseSettings({ ...INPUT, ...overrides })).toThrow(SettingsError);
    expect(() => parseSettings({ ...INPUT, ...overrides })).toThrow(message);
  });

  it('rejects input that is not an object', () => {
    expect(() => parseSettings(null)).toThrow(SettingsError);
  });

  it('keeps the saved password when none is typed', () => {
    const next = parseSettings({ ...INPUT, password: '', fromName: 'Acme Ltd' }, SAVED);
    expect(next).toEqual({ ...SAVED, fromName: 'Acme Ltd' });
  });

  it('never reuses the saved password for another mailbox or server', () => {
    expect(() => parseSettings({ ...INPUT, password: '', user: 'other@acme.test' }, SAVED)).toThrow(
      /Enter the password/,
    );
    expect(() => parseSettings({ ...INPUT, password: '', host: 'smtp.elsewhere.test' }, SAVED)).toThrow(
      /Enter the password/,
    );
  });

  it('saves, loads and clears', async () => {
    const file = path.join(dir, 'nested', 'settings.json');
    const store = createSettingsStore(file);
    expect(await store.load()).toBeNull();

    await store.save(SAVED);
    expect(await store.load()).toEqual(SAVED);
    expect(JSON.parse(await readFile(file, 'utf8')).host).toBe('smtp.titan.email');

    await store.clear();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
