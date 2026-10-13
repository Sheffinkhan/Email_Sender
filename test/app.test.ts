import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { NotConfiguredError, NotSignedInError, type GraphAuth } from '../src/graph/auth.js';
import type { OutgoingMail } from '../src/graph/transport.js';
import { createSettingsStore } from '../src/settings.js';
import { createTemplateStore } from '../src/templateStore.js';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const REDIRECT = 'http://localhost:3000/auth/callback';
const TEMPLATE = { name: 'Welcome', heading: 'Hi {{name}}', brandName: 'Acme' };

let dir: string;
let server: Server;
let base: string;
let sent: OutgoingMail[];
let account: string | null;
let auth: { [K in keyof GraphAuth]: ReturnType<typeof vi.fn> };

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, location: response.headers.get('location') };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'email-sender-'));
  await writeFile(path.join(dir, 'index.html'), '<h1>Email Sender</h1>');
  sent = [];
  account = 'me@outlook.com';
  auth = {
    status: vi.fn(async () => ({ configured: true, account })),
    beginLogin: vi.fn(async () => 'https://login.test/authorize'),
    completeLogin: vi.fn(async () => {}),
    logout: vi.fn(async () => {
      account = null;
    }),
    getToken: vi.fn(async () => 'token'),
  };

  const app = createApp({
    auth: auth as unknown as GraphAuth,
    transport: {
      send: async (mail) => {
        if (mail.to.email.startsWith('bounce')) throw new Error('Mailbox unavailable');
        sent.push(mail);
      },
    },
    templates: createTemplateStore(path.join(dir, 'templates')),
    settings: createSettingsStore(path.join(dir, 'settings.json')),
    publicDir: dir,
    redirectUri: REDIRECT,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe('access', () => {
  it('serves the page', async () => {
    const response = await fetch(base);
    expect(await response.text()).toContain('Email Sender');
  });

  it('refuses requests coming from another website', async () => {
    const result = await call('POST', '/auth/logout', undefined, { Origin: 'https://evil.test' });
    expect(result.status).toBe(403);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('refuses a bad origin header', async () => {
    expect((await call('GET', '/api/status', undefined, { Origin: 'null' })).status).toBe(403);
  });

  it('allows its own origin', async () => {
    expect((await call('GET', '/api/status', undefined, { Origin: base })).status).toBe(200);
  });
});

describe('connection', () => {
  it('reports status with the redirect URI to register', async () => {
    expect((await call('GET', '/api/status')).data).toEqual({
      configured: true,
      account: 'me@outlook.com',
      redirectUri: REDIRECT,
    });
  });

  it('saves settings and signs out of the old registration', async () => {
    const result = await call('PUT', '/api/settings', { clientId: CLIENT_ID });
    expect(result.status).toBe(200);
    expect(auth.logout).toHaveBeenCalled();
    expect(result.data.account).toBeNull();
  });

  it('rejects a malformed client id', async () => {
    const result = await call('PUT', '/api/settings', { clientId: 'nope' });
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/client/i);
  });

  it('redirects to Microsoft to sign in', async () => {
    const result = await call('GET', '/auth/login');
    expect(result.status).toBe(302);
    expect(result.location).toBe('https://login.test/authorize');
  });

  it('says so when sign-in is requested before setup', async () => {
    auth.beginLogin.mockRejectedValue(new NotConfiguredError('Connect Outlook first'));
    expect((await call('GET', '/auth/login')).status).toBe(409);
  });

  it('completes sign-in on the callback', async () => {
    const result = await call('GET', '/auth/callback?code=abc&state=xyz');
    expect(auth.completeLogin).toHaveBeenCalledWith('abc', 'xyz');
    expect(result.location).toBe('/');
  });

  it('passes sign-in failures back to the page', async () => {
    auth.completeLogin.mockRejectedValue(new Error('Sign-in session expired. Start again.'));
    const failed = await call('GET', '/auth/callback?code=abc&state=xyz');
    expect(failed.location).toBe('/?auth_error=Sign-in%20session%20expired.%20Start%20again.');

    const denied = await call('GET', '/auth/callback?error=access_denied&error_description=User%20cancelled');
    expect(denied.location).toBe('/?auth_error=User%20cancelled');

    const empty = await call('GET', '/auth/callback');
    expect(empty.location).toBe('/?auth_error=Sign-in%20was%20cancelled');
  });

  it('signs out', async () => {
    expect((await call('POST', '/auth/logout')).data.account).toBeNull();
  });
});

describe('templates', () => {
  it('creates, reads, lists and deletes', async () => {
    const created = await call('POST', '/api/templates', TEMPLATE);
    expect(created.data.id).toBe('welcome');
    expect((await call('GET', '/api/templates')).data).toEqual([{ id: 'welcome', name: 'Welcome' }]);
    expect((await call('GET', '/api/templates/welcome')).data.heading).toBe('Hi {{name}}');
    expect((await call('DELETE', '/api/templates/welcome')).status).toBe(200);
    expect((await call('DELETE', '/api/templates/welcome')).status).toBe(404);
    expect((await call('GET', '/api/templates/welcome')).status).toBe(404);
  });

  it('rejects invalid templates and ids', async () => {
    expect((await call('POST', '/api/templates', { name: '' })).status).toBe(400);
    expect((await call('GET', '/api/templates/Bad_Id')).status).toBe(400);
  });

  it('rejects malformed and oversized requests', async () => {
    expect((await call('POST', '/api/templates', '{ not json')).status).toBe(400);
    const huge = await call('POST', '/api/templates', { name: 'Big', details: 'x'.repeat(9_000_000) });
    expect(huge.status).toBe(413);
  });
});

describe('preview', () => {
  it('renders for the first recipient', async () => {
    const result = await call('POST', '/api/preview', { template: TEMPLATE, recipients: 'Anna <anna@client.com>' });
    expect(result.data.html).toContain('Hi Anna');
  });

  it('uses a sample name when there is no recipient yet', async () => {
    expect((await call('POST', '/api/preview', { template: TEMPLATE })).data.html).toContain('Hi Alex');
  });

  it('rejects a missing template', async () => {
    expect((await call('POST', '/api/preview', {})).status).toBe(400);
  });
});

describe('send', () => {
  const request = (overrides: object = {}) => ({
    template: TEMPLATE,
    subject: 'Welcome {{name}}',
    recipients: 'Anna <anna@client.com>, ben@client.com',
    ...overrides,
  });

  it('sends a separate personalised email to each recipient', async () => {
    const result = await call('POST', '/api/send', request());
    expect(result.data.results).toEqual([
      { email: 'anna@client.com', ok: true },
      { email: 'ben@client.com', ok: true },
    ]);
    expect(sent.map((mail) => [mail.to.email, mail.subject])).toEqual([
      ['anna@client.com', 'Welcome Anna'],
      ['ben@client.com', 'Welcome there'],
    ]);
    expect(sent[0].html).toContain('Hi Anna');
  });

  it('reports per-recipient failures', async () => {
    const result = await call('POST', '/api/send', request({ recipients: 'bounce@client.com, ok@client.com' }));
    expect(result.data.results).toEqual([
      { email: 'bounce@client.com', ok: false, error: 'Mailbox unavailable' },
      { email: 'ok@client.com', ok: true },
    ]);
  });

  it.each([
    ['an empty subject', { subject: '  ' }, /Subject/],
    ['a missing subject', { subject: undefined }, /Subject/],
    ['no recipients', { recipients: ' ' }, /at least one/],
    ['a missing To', { recipients: undefined }, /To is required/],
    ['a bad address', { recipients: 'anna@client.com, oops' }, /oops/],
  ])('rejects %s and sends nothing', async (_label, overrides, message) => {
    const result = await call('POST', '/api/send', request(overrides));
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(message);
    expect(sent).toEqual([]);
  });

  it('refuses uploads that Outlook would reject for size', async () => {
    const upload = (bytes: number) => `data:image/gif;base64,${'A'.repeat(bytes)}`;
    const template = { ...TEMPLATE, bannerUrl: upload(1_400_000), mediaUrl: upload(2_500_000) };
    const result = await call('POST', '/api/send', request({ template }));
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/too large together/);
    expect(sent).toEqual([]);

    const linked = { ...TEMPLATE, bannerUrl: upload(1_400_000), mediaUrl: 'https://acme.test/big.gif' };
    expect((await call('POST', '/api/send', request({ template: linked }))).status).toBe(200);
  });

  it('requires a signed-in mailbox', async () => {
    auth.getToken.mockRejectedValue(new NotSignedInError('Sign in to Outlook first'));
    const result = await call('POST', '/api/send', request());
    expect(result.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it('hides unexpected errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.getToken.mockRejectedValue(new Error('secret internal detail'));
    const result = await call('POST', '/api/send', request());
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('Something went wrong');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
