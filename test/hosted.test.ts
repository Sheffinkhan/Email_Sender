import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createHostedApp } from '../src/hosted.js';
import { createLoginGate } from '../src/login.js';
import { envSettingsStore } from '../src/settings.js';
import type { OutgoingMail } from '../src/smtp.js';
import { createTemplateStore, fileBackend } from '../src/templateStore.js';

const PASSWORD = 'correct horse battery';
const ENV = {
  SMTP_USER: 'info@acme.test',
  SMTP_PASSWORD: 'not-a-real-password',
  SMTP_FROM_NAME: 'Acme',
};

let dir: string;
let server: Server | undefined;
let base: string;

async function serve(app: express.Express) {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: { ...(typeof body === 'object' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'object' ? JSON.stringify(body) : (body as string),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

async function logIn(): Promise<string> {
  const result = await call('POST', '/api/login', { password: PASSWORD });
  expect(result.status).toBe(200);
  return (result.headers.get('set-cookie') ?? '').split(';')[0];
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'email-sender-'));
  await mkdir(path.join(dir, 'public'));
  await mkdir(path.join(dir, 'templates'));
  await writeFile(path.join(dir, 'public', 'index.html'), '<h1>Email Sender</h1>');
  await writeFile(path.join(dir, 'public', 'login.html'), '<h1>Log in</h1>');
  await writeFile(path.join(dir, 'templates', 'welcome.json'), JSON.stringify({ name: 'Welcome' }));
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('online app behind a password', () => {
  let sent: OutgoingMail[];
  let uploadImage: ReturnType<typeof vi.fn<(data: Buffer, type: string) => Promise<string>>>;

  beforeEach(async () => {
    sent = [];
    uploadImage = vi.fn(async () => 'https://store.test/uploads/image-x.gif');
    await serve(
      createApp({
        transport: { send: async (mail) => void sent.push(mail) },
        verify: async () => {},
        templates: createTemplateStore(fileBackend(path.join(dir, 'templates'))),
        settings: envSettingsStore(ENV),
        publicDir: path.join(dir, 'public'),
        login: createLoginGate(PASSWORD),
        uploadImage,
        wrongPasswordDelayMs: 0,
      }),
    );
  });

  it('sends visitors to the login page and keeps the API closed', async () => {
    const page = await call('GET', '/');
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/login.html');
    expect((await call('GET', '/login.html')).data).toContain('Log in');
    expect((await call('GET', '/api/status')).status).toBe(401);
    expect((await call('POST', '/api/send', { subject: 'x', recipients: 'a@b.co' })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it('refuses a wrong password', async () => {
    const result = await call('POST', '/api/login', { password: 'guess' });
    expect(result.status).toBe(401);
    expect(result.data.error).toBe('Wrong password');
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('opens up after logging in, from any host name', async () => {
    const cookie = await logIn();
    const page = await call('GET', '/', undefined, { Cookie: cookie });
    expect(page.data).toContain('Email Sender');

    const status = await call('GET', '/api/status', undefined, { Cookie: cookie, Host: 'emailsender.vercel.app' });
    expect(status.data).toEqual({
      hosted: true,
      managed: true,
      uploads: 'hosted',
      templatesReadOnly: false,
      configured: true,
      account: 'info@acme.test',
      fromName: 'Acme',
      host: 'smtpout.secureserver.net',
      port: 465,
    });
  });

  it('issues a secure, script-proof session cookie', async () => {
    const result = await call('POST', '/api/login', { password: PASSWORD });
    const cookie = result.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('refuses requests sent from another website even with a session', async () => {
    const cookie = await logIn();
    const result = await call('POST', '/api/send', { subject: 'x', recipients: 'a@b.co' }, {
      Cookie: cookie,
      Origin: 'https://evil.test',
    });
    expect(result.status).toBe(403);
    expect((await call('GET', '/api/status', undefined, { Cookie: cookie, Origin: 'not a url' })).status).toBe(403);
    expect((await call('GET', '/api/status', undefined, { Cookie: cookie, Origin: base })).status).toBe(200);
  });

  it('logs out', async () => {
    const cookie = await logIn();
    const result = await call('POST', '/api/logout', undefined, { Cookie: cookie });
    expect(result.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('stores uploaded images and returns their address', async () => {
    const cookie = await logIn();
    const result = await call('POST', '/api/uploads', 'GIF89a-bytes', { Cookie: cookie, 'Content-Type': 'image/gif' });
    expect(result.data).toEqual({ url: 'https://store.test/uploads/image-x.gif' });
    const [data, type] = uploadImage.mock.calls[0];
    expect(data.toString()).toBe('GIF89a-bytes');
    expect(type).toBe('image/gif');
  });

  it.each([
    ['a non-image', 'text/html', 'hello', 400],
    ['an empty file', 'image/png', '', 400],
    ['a file over 2 MB', 'image/png', 'x'.repeat(2_100_000), 413],
  ])('refuses %s', async (_label, type, body, status) => {
    const cookie = await logIn();
    expect((await call('POST', '/api/uploads', body, { Cookie: cookie, 'Content-Type': type })).status).toBe(status);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('does not let the mailbox be changed from the app', async () => {
    const cookie = await logIn();
    const result = await call('DELETE', '/api/settings', undefined, { Cookie: cookie });
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/Vercel/);
  });
});

describe('createHostedApp', () => {
  const { SMTP_PASSWORD: _mailboxPassword, ...NO_PASSWORDS } = ENV;

  it('refuses to run with no password at all', async () => {
    await serve(createHostedApp(NO_PASSWORDS, dir));
    const result = await call('GET', '/api/status');
    expect(result.status).toBe(503);
    expect(result.data).toMatch(/add SMTP_USER and SMTP_PASSWORD/);
  });

  it('lets the mailbox password log in when no app password is set', async () => {
    await serve(createHostedApp(ENV, dir));
    expect((await call('POST', '/api/login', { password: 'guess' })).status).toBe(401);
    const result = await call('POST', '/api/login', { password: ENV.SMTP_PASSWORD });
    expect(result.status).toBe(200);
    const cookie = (result.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await call('GET', '/api/status', undefined, { Cookie: cookie })).data).toMatchObject({
      configured: true,
      account: 'info@acme.test',
    });
  });

  it('accepts only the app password when one is set', async () => {
    await serve(createHostedApp({ ...ENV, APP_PASSWORD: PASSWORD }, dir));
    expect((await call('POST', '/api/login', { password: ENV.SMTP_PASSWORD })).status).toBe(401);
    expect((await call('POST', '/api/login', { password: PASSWORD })).status).toBe(200);
  });

  it('refuses a short app password', async () => {
    await serve(createHostedApp({ ...ENV, APP_PASSWORD: 'short' }, dir));
    const result = await call('GET', '/');
    expect(result.status).toBe(503);
    expect(result.data).toMatch(/APP_PASSWORD must be at least 12 characters/);
  });

  it('asks for an app password when the mailbox password is too short to guard the site', async () => {
    await serve(createHostedApp({ ...ENV, SMTP_PASSWORD: 'short' }, dir));
    const result = await call('GET', '/');
    expect(result.status).toBe(503);
    expect(result.data).toMatch(/mailbox password is shorter than 12 characters/);
  });

  it('serves bundled templates read-only without a Blob store', async () => {
    await serve(createHostedApp({ ...ENV, APP_PASSWORD: PASSWORD }, dir));
    const cookie = await logIn();
    const status = await call('GET', '/api/status', undefined, { Cookie: cookie });
    expect(status.data).toMatchObject({ uploads: 'inline', templatesReadOnly: true, configured: true });
    expect((await call('GET', '/api/templates', undefined, { Cookie: cookie })).data).toEqual([
      { id: 'welcome', name: 'Welcome' },
    ]);
    const save = await call('POST', '/api/templates', { name: 'New' }, { Cookie: cookie });
    expect(save.status).toBe(400);
    expect(save.data.error).toMatch(/Blob store/);
  });

  it('uses Blob storage when a token is set', async () => {
    await serve(createHostedApp({ ...ENV, APP_PASSWORD: PASSWORD, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test' }, dir));
    const cookie = await logIn();
    const status = await call('GET', '/api/status', undefined, { Cookie: cookie });
    expect(status.data).toMatchObject({ uploads: 'hosted', templatesReadOnly: false });
  });
});
