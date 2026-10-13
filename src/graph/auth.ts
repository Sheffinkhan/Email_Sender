import { createHash, randomBytes } from 'node:crypto';
import type { PublicClientApplication } from '@azure/msal-node';
import type { Settings } from '../settings.js';

export class NotConfiguredError extends Error {}
export class NotSignedInError extends Error {}

// Sending is the only permission the app asks for.
export const SCOPES = ['Mail.Send'];

/** The part of MSAL this module uses, so tests can supply a fake. */
export type MsalClient = Pick<
  PublicClientApplication,
  'getAuthCodeUrl' | 'acquireTokenByCode' | 'acquireTokenSilent' | 'getTokenCache'
>;

export interface AuthStatus {
  configured: boolean;
  account: string | null;
}

export interface GraphAuthOptions {
  loadSettings: () => Promise<Settings | null>;
  createClient: (settings: Settings) => MsalClient;
  redirectUri: string;
}

export function createGraphAuth({ loadSettings, createClient, redirectUri }: GraphAuthOptions) {
  let cached: { key: string; client: MsalClient } | null = null;
  let pending: { state: string; verifier: string } | null = null;

  async function client(): Promise<MsalClient | null> {
    const settings = await loadSettings();
    if (!settings) return null;
    const key = `${settings.clientId}|${settings.tenant}`;
    if (cached?.key !== key) cached = { key, client: createClient(settings) };
    return cached.client;
  }

  async function requireClient(): Promise<MsalClient> {
    const current = await client();
    if (!current) throw new NotConfiguredError('Connect Outlook first');
    return current;
  }

  async function signOutAll(current: MsalClient): Promise<void> {
    const cache = current.getTokenCache();
    for (const account of await cache.getAllAccounts()) await cache.removeAccount(account);
  }

  return {
    async status(): Promise<AuthStatus> {
      const current = await client();
      if (!current) return { configured: false, account: null };
      const [account] = await current.getTokenCache().getAllAccounts();
      return { configured: true, account: account?.username ?? null };
    },

    /** Starts sign-in and returns the Microsoft login URL to send the browser to. */
    async beginLogin(): Promise<string> {
      const current = await requireClient();
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      pending = { state, verifier };
      return current.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri,
        state,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        prompt: 'select_account',
      });
    },

    async completeLogin(code: string, state: string): Promise<void> {
      const current = await requireClient();
      if (!pending || pending.state !== state) {
        throw new Error('Sign-in session expired. Start again.');
      }
      const { verifier } = pending;
      pending = null;
      // One mailbox at a time, so the From address is never ambiguous.
      await signOutAll(current);
      await current.acquireTokenByCode({ code, scopes: SCOPES, redirectUri, codeVerifier: verifier });
    },

    async logout(): Promise<void> {
      const current = await client();
      if (current) await signOutAll(current);
    },

    async getToken(): Promise<string> {
      const current = await requireClient();
      const [account] = await current.getTokenCache().getAllAccounts();
      if (!account) throw new NotSignedInError('Sign in to Outlook first');
      try {
        const result = await current.acquireTokenSilent({ account, scopes: SCOPES });
        return result.accessToken;
      } catch {
        throw new NotSignedInError('Outlook sign-in expired. Sign in again.');
      }
    },
  };
}

export type GraphAuth = ReturnType<typeof createGraphAuth>;
