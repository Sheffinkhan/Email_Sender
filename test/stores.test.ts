import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore, parseSettings, SettingsError } from '../src/settings.js';
import { createTemplateStore, normaliseTemplate, slugify, TemplateError } from '../src/templateStore.js';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
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
  it('defaults the tenant to common', () => {
    expect(parseSettings({ clientId: CLIENT_ID.toUpperCase() })).toEqual({
      clientId: CLIENT_ID,
      tenant: 'common',
    });
  });

  it('accepts tenant aliases, ids and domains', () => {
    for (const tenant of ['consumers', 'organizations', CLIENT_ID, 'contoso.onmicrosoft.com']) {
      expect(parseSettings({ clientId: CLIENT_ID, tenant }).tenant).toBe(tenant);
    }
  });

  it('rejects a bad client id or tenant', () => {
    expect(() => parseSettings({ clientId: 'abc' })).toThrow(SettingsError);
    expect(() => parseSettings(null)).toThrow(SettingsError);
    expect(() => parseSettings({ clientId: CLIENT_ID, tenant: 'evil.test/path' })).toThrow(SettingsError);
  });

  it('saves and loads', async () => {
    const file = path.join(dir, 'nested', 'settings.json');
    const store = createSettingsStore(file);
    expect(await store.load()).toBeNull();
    await store.save({ clientId: CLIENT_ID, tenant: 'consumers' });
    expect(await store.load()).toEqual({ clientId: CLIENT_ID, tenant: 'consumers' });
    expect(JSON.parse(await readFile(file, 'utf8')).tenant).toBe('consumers');
  });
});
