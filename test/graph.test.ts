import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGraphAuth,
  NotConfiguredError,
  NotSignedInError,
  type MsalClient,
} from '../src/graph/auth.js';
import { createMsalClient, fileCachePlugin } from '../src/graph/msal.js';
import { createGraphTransport } from '../src/graph/transport.js';
import { sendToAll } from '../src/mailer.js';
import { normaliseTemplate } from '../src/templateStore.js';
import type { Settings } from '../src/settings.js';

const SETTINGS: Settings = { clientId: '11111111-2222-3333-4444-555555555555', tenant: 'common' };
const REDIRECT = 'http://localhost:3000/auth/callback';

function fakeMsal(accounts: { username: string }[] = []) {
  const client = {
    getAuthCodeUrl: vi.fn(async (request: { state: string }) => `https://login.test/?state=${request.state}`),
    acquireTokenByCode: vi.fn(async () => {
      accounts.push({ username: 'me@outlook.com' });
      return { accessToken: 'token-from-code' };
    }),
    acquireTokenSilent: vi.fn(async () => ({ accessToken: 'silent-token' })),
    getTokenCache: () => ({
      getAllAccounts: async () => [...accounts],
      removeAccount: async (account: { username: string }) => {
        accounts.splice(accounts.indexOf(account), 1);
      },
    }),
  };
  return { client, asMsal: client as unknown as MsalClient };
}

function authWith(msal: ReturnType<typeof fakeMsal>, settings: Settings | null = SETTINGS) {
  const createClient = vi.fn(() => msal.asMsal);
  const auth = createGraphAuth({ loadSettings: async () => settings, createClient, redirectUri: REDIRECT });
  return { auth, createClient };
}

describe('graph auth', () => {
  it('reports not configured without settings', async () => {
    const { auth } = authWith(fakeMsal(), null);
    expect(await auth.status()).toEqual({ configured: false, account: null });
    await expect(auth.beginLogin()).rejects.toThrow(NotConfiguredError);
    await expect(auth.getToken()).rejects.toThrow(NotConfiguredError);
    await expect(auth.logout()).resolves.toBeUndefined();
  });

  it('signs in with PKCE and then reports the account', async () => {
    const msal = fakeMsal();
    const { auth, createClient } = authWith(msal);
    expect(await auth.status()).toEqual({ configured: true, account: null });

    const url = await auth.beginLogin();
    const state = new URL(url).searchParams.get('state') as string;
    const loginRequest = msal.client.getAuthCodeUrl.mock.calls[0][0] as Record<string, unknown>;
    expect(loginRequest).toMatchObject({
      scopes: ['Mail.Send'],
      redirectUri: REDIRECT,
      codeChallengeMethod: 'S256',
    });

    await auth.completeLogin('the-code', state);
    expect(msal.client.acquireTokenByCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'the-code', redirectUri: REDIRECT, codeVerifier: expect.any(String) }),
    );
    expect(await auth.status()).toEqual({ configured: true, account: 'me@outlook.com' });
    expect(await auth.getToken()).toBe('silent-token');
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback with the wrong state, and a replayed one', async () => {
    const msal = fakeMsal();
    const { auth } = authWith(msal);
    await expect(auth.completeLogin('code', 'never-started')).rejects.toThrow(/expired/);

    const state = new URL(await auth.beginLogin()).searchParams.get('state') as string;
    await expect(auth.completeLogin('code', `${state}x`)).rejects.toThrow(/expired/);
    await auth.completeLogin('code', state);
    await expect(auth.completeLogin('code', state)).rejects.toThrow(/expired/);
    expect(msal.client.acquireTokenByCode).toHaveBeenCalledTimes(1);
  });

  it('replaces a previous account on sign-in', async () => {
    const msal = fakeMsal([{ username: 'old@outlook.com' }]);
    const { auth } = authWith(msal);
    const state = new URL(await auth.beginLogin()).searchParams.get('state') as string;
    await auth.completeLogin('code', state);
    expect(await auth.status()).toEqual({ configured: true, account: 'me@outlook.com' });
  });

  it('signs out', async () => {
    const { auth } = authWith(fakeMsal([{ username: 'me@outlook.com' }]));
    await auth.logout();
    expect((await auth.status()).account).toBeNull();
    await expect(auth.getToken()).rejects.toThrow(NotSignedInError);
  });

  it('asks for a new sign-in when the token cannot be refreshed', async () => {
    const msal = fakeMsal([{ username: 'me@outlook.com' }]);
    msal.client.acquireTokenSilent.mockRejectedValue(new Error('interaction_required'));
    await expect(authWith(msal).auth.getToken()).rejects.toThrow(NotSignedInError);
  });
});

describe('msal client', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'email-sender-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists the token cache to a file', async () => {
    const file = path.join(dir, 'nested', 'cache.json');
    const plugin = fileCachePlugin(file);
    const tokenCache = { deserialize: vi.fn(), serialize: () => '{"cached":true}' };
    const context = (cacheHasChanged: boolean) => ({ cacheHasChanged, tokenCache }) as never;

    await plugin.beforeCacheAccess(context(false));
    expect(tokenCache.deserialize).not.toHaveBeenCalled();

    await plugin.afterCacheAccess(context(false));
    await expect(readFile(file, 'utf8')).rejects.toThrow();

    await plugin.afterCacheAccess(context(true));
    expect(await readFile(file, 'utf8')).toBe('{"cached":true}');

    await plugin.beforeCacheAccess(context(false));
    expect(tokenCache.deserialize).toHaveBeenCalledWith('{"cached":true}');
  });

  it('builds a client that starts with no accounts', async () => {
    const client = createMsalClient(SETTINGS, path.join(dir, 'cache.json'));
    expect(await client.getTokenCache().getAllAccounts()).toEqual([]);
  });
});

describe('graph transport', () => {
  const mail = {
    to: { email: 'anna@client.com', name: 'Anna' },
    subject: 'Welcome',
    html: '<img src="data:image/png;base64,AAAA"><p>Hi</p>',
  };
  const noSleep = vi.fn(async () => {});

  beforeEach(() => noSleep.mockClear());

  it('posts the message to Graph with inline images attached', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    await createGraphTransport(async () => 'tok', fetchFn as never, noSleep).send(mail);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe('Welcome');
    expect(body.message.body).toEqual({ contentType: 'HTML', content: '<img src="cid:image1"><p>Hi</p>' });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'anna@client.com', name: 'Anna' } }]);
    expect(body.message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'image1.png',
        contentType: 'image/png',
        contentBytes: 'AAAA',
        contentId: 'image1',
        isInline: true,
      },
    ]);
  });

  it('omits the name for bare addresses', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    await createGraphTransport(async () => 'tok', fetchFn as never, noSleep).send({
      ...mail,
      to: { email: 'a@x.com', name: '' },
    });
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'a@x.com' } }]);
  });

  it('waits and retries when throttled', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await createGraphTransport(async () => 'tok', fetchFn as never, noSleep).send(mail);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls).toEqual([[3000], [2000]]);
  });

  it('gives up after repeated throttling', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '999' } }));
    const transport = createGraphTransport(async () => 'tok', fetchFn as never, noSleep);
    await expect(transport.send(mail)).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(noSleep).toHaveBeenLastCalledWith(30_000);
  });

  it('reports the reason Graph gives for a rejection', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'Access is denied.' } }), { status: 403 }),
    );
    const transport = createGraphTransport(async () => 'tok', fetchFn as never, noSleep);
    await expect(transport.send(mail)).rejects.toThrow('Outlook rejected the message (403): Access is denied.');
  });

  it('copes with a rejection that has no JSON body', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' }));
    const transport = createGraphTransport(async () => 'tok', fetchFn as never, noSleep);
    await expect(transport.send(mail)).rejects.toThrow('(500): Server Error');
  });
});

describe('sendToAll', () => {
  it('sends one personalised email each and keeps going after a failure', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Mailbox full'))
      .mockRejectedValueOnce('odd failure');
    const template = normaliseTemplate({ name: 'Welcome', heading: 'Hi {{name}}' });
    const recipients = [
      { email: 'anna@client.com', name: 'Anna' },
      { email: 'ben@client.com', name: '' },
      { email: 'cy@client.com', name: 'Cy' },
    ];

    const results = await sendToAll(template, 'Hello {{name}}', recipients, { send });

    expect(results).toEqual([
      { email: 'anna@client.com', ok: true },
      { email: 'ben@client.com', ok: false, error: 'Mailbox full' },
      { email: 'cy@client.com', ok: false, error: 'odd failure' },
    ]);
    expect(send.mock.calls[0][0]).toMatchObject({ to: recipients[0], subject: 'Hello Anna' });
    expect(send.mock.calls[0][0].html).toContain('Hi Anna');
    expect(send.mock.calls[1][0]).toMatchObject({ subject: 'Hello there' });
    expect(send.mock.calls[1][0].html).not.toContain('Anna');
  });
});
