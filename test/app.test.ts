import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createSettingsStore, SettingsError, type Settings } from '../src/settings.js';
import type { OutgoingMail } from '../src/smtp.js';
import { createTemplateStore, fileBackend } from '../src/templateStore.js';

const LOCAL_MODE = { hosted: false, managed: false, uploads: 'inline', templatesReadOnly: false, templateLimit: 5 };
const TEMPLATE = { name: 'Welcome', heading: 'Hi {{name}}', brandName: 'Acme' };
const ACCOUNT: Settings = {
  host: 'smtp.titan.email',
  port: 465,
  user: 'info@acme.test',
  password: 'not-a-real-password',
  fromName: 'Acme',
};

let dir: string;
let server: Server;
let base: string;
let sent: OutgoingMail[];
let opened = 0;
let closed = 0;
let settings: ReturnType<typeof createSettingsStore>;
let verify: ReturnType<typeof vi.fn<(settings: Settings) => Promise<void>>>;

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'email-sender-'));
  await writeFile(path.join(dir, 'index.html'), '<h1>Email Sender</h1>');
  sent = [];
  opened = 0;
  closed = 0;
  settings = createSettingsStore(path.join(dir, 'settings.json'));
  await settings.save(ACCOUNT);
  verify = vi.fn(async () => {});

  const app = createApp({
    transport: {
      open: async () => {
        opened++;
        return {
          send: async (mail) => {
            if (mail.to.email.startsWith('bounce')) throw new Error('Mailbox unavailable');
            sent.push(mail);
            return mail.to.email.startsWith('nocopy')
              ? { savedToSent: false, warning: 'Sent, but not copied to the Sent folder: no Sent folder was found in the mailbox' }
              : { savedToSent: true };
          },
          close: async () => {
            closed++;
          },
        };
      },
    },
    verify,
    checkSent: async () => 'Copies of sent emails will be saved to the "Sent Items" folder.',
    templates: createTemplateStore(fileBackend(path.join(dir, 'templates'))),
    settings,
    publicDir: dir,
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
    const result = await call('DELETE', '/api/settings', undefined, { Origin: 'https://evil.test' });
    expect(result.status).toBe(403);
    expect(await settings.load()).toEqual(ACCOUNT);
  });

  it('refuses a bad origin header', async () => {
    expect((await call('GET', '/api/status', undefined, { Origin: 'null' })).status).toBe(403);
  });

  it('allows its own origin', async () => {
    expect((await call('GET', '/api/status', undefined, { Origin: base })).status).toBe(200);
  });
});

describe('connection', () => {
  const status = { ...LOCAL_MODE, configured: true, account: 'info@acme.test', fromName: 'Acme', host: 'smtp.titan.email', port: 465 };

  it('reports the connected mailbox without the password', async () => {
    const result = await call('GET', '/api/status');
    expect(result.data).toEqual(status);
    expect(JSON.stringify(result.data)).not.toContain(ACCOUNT.password);
  });

  it('tests the login, then saves', async () => {
    await settings.clear();
    expect((await call('GET', '/api/status')).data).toEqual({ ...LOCAL_MODE, configured: false, account: null });

    const result = await call('PUT', '/api/settings', ACCOUNT);
    expect(result.data).toEqual({ ...status, sentNote: 'Copies of sent emails will be saved to the "Sent Items" folder.' });
    expect(verify).toHaveBeenCalledWith(ACCOUNT);
    expect(await settings.load()).toEqual(ACCOUNT);
  });

  it('saves nothing when the mail server refuses the login', async () => {
    await settings.clear();
    verify.mockRejectedValue(new SettingsError('The mail server refused the email address or password.'));
    const result = await call('PUT', '/api/settings', ACCOUNT);
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/refused/);
    expect(await settings.load()).toBeNull();
  });

  it('keeps the saved password when it is left empty', async () => {
    const result = await call('PUT', '/api/settings', { ...ACCOUNT, password: '', fromName: 'Acme Ltd' });
    expect(result.data.fromName).toBe('Acme Ltd');
    expect((await settings.load())?.password).toBe(ACCOUNT.password);
  });

  it('rejects incomplete details before contacting the server', async () => {
    const result = await call('PUT', '/api/settings', { ...ACCOUNT, port: 25 });
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it('tests the saved login on request', async () => {
    expect((await call('POST', '/api/settings/test')).data).toEqual({
      ok: true,
      sentNote: 'Copies of sent emails will be saved to the "Sent Items" folder.',
    });
    expect(verify).toHaveBeenCalledWith(ACCOUNT);

    await settings.clear();
    expect((await call('POST', '/api/settings/test')).status).toBe(409);
  });

  it('keeps uploads inside the template when there is no image storage', async () => {
    const result = await call('POST', '/api/uploads', 'GIF89a', { 'Content-Type': 'image/gif' });
    expect(result.status).toBe(400);
  });

  it('has no login routes', async () => {
    expect((await call('POST', '/api/login', { password: 'x' })).status).toBe(404);
  });

  it('disconnects', async () => {
    expect((await call('DELETE', '/api/settings')).data).toEqual({ ...LOCAL_MODE, configured: false, account: null });
    expect(await settings.load()).toBeNull();
  });

  it('hides unexpected errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    verify.mockRejectedValue(new Error('secret internal detail'));
    const result = await call('PUT', '/api/settings', ACCOUNT);
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('Something went wrong');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
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

  it('keeps at most five templates but always allows saving over one', async () => {
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      expect((await call('POST', '/api/templates', { name })).status).toBe(200);
    }
    const sixth = await call('POST', '/api/templates', { name: 'Six' });
    expect(sixth.status).toBe(400);
    expect(sixth.data.error).toMatch(/up to 5 templates/);

    const update = await call('POST', '/api/templates', { id: 'three', name: 'Three', heading: 'Changed' });
    expect(update.status).toBe(200);
    expect((await call('GET', '/api/templates/three')).data.heading).toBe('Changed');

    await call('DELETE', '/api/templates/one');
    expect((await call('POST', '/api/templates', { name: 'Six' })).status).toBe(200);
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

  it('sends the whole batch in one session and closes it', async () => {
    await call('POST', '/api/send', request());
    expect([opened, closed]).toEqual([1, 1]);
  });

  it('reports when a delivered email could not be copied to Sent', async () => {
    const result = await call('POST', '/api/send', request({ recipients: 'nocopy@client.com' }));
    expect(result.data.results).toEqual([
      {
        email: 'nocopy@client.com',
        ok: true,
        warning: 'Sent, but not copied to the Sent folder: no Sent folder was found in the mailbox',
      },
    ]);
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

  it('requires a connected mailbox', async () => {
    await settings.clear();
    const result = await call('POST', '/api/send', request());
    expect(result.status).toBe(409);
    expect(result.data.error).toMatch(/Connect your email account/);
    expect(sent).toEqual([]);
  });
});
