import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEmail } from './recipients.js';

export class SettingsError extends Error {}
export class NotConfiguredError extends Error {}

/** The mailbox emails are sent from, and the SMTP server that sends them. */
export interface Settings {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
// Both encrypt the connection. Unencrypted ports are not offered.
const PORTS = [465, 587];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates untrusted input. An empty password keeps the saved one, but only
 * for the same mailbox on the same server, so it is never sent anywhere new.
 */
export function parseSettings(input: unknown, saved: Settings | null = null): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const host = text(source.host).toLowerCase();
  const port = Number(source.port);
  const user = text(source.user);
  const fromName = text(source.fromName);
  let password = typeof source.password === 'string' ? source.password : '';

  if (!isEmail(user)) throw new SettingsError('Enter the full email address');
  if (!HOST.test(host)) throw new SettingsError('Enter the sending server, for example smtp.titan.email');
  if (!PORTS.includes(port)) throw new SettingsError('Port must be 465 or 587');
  if (fromName.length > 80) throw new SettingsError('Your name is too long');
  if (!password && saved && saved.user === user && saved.host === host) password = saved.password;
  if (!password) throw new SettingsError('Enter the password');
  if (password.length > 500) throw new SettingsError('Password is too long');

  return { host, port, user, password, fromName };
}

export function createSettingsStore(file: string) {
  return {
    async load(): Promise<Settings | null> {
      try {
        return parseSettings(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        return null;
      }
    },

    async save(settings: Settings): Promise<void> {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    },

    async clear(): Promise<void> {
      await rm(file, { force: true });
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
