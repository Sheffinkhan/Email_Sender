import { ImapFlow } from 'imapflow';
import type { Settings } from './settings.js';

/** What happened to the copy of one sent email. */
export interface SaveReport {
  savedToSent: boolean;
  warning?: string;
}

/** The part of ImapFlow this module uses, so tests can supply a fake. */
export interface ImapClient {
  connect(): Promise<void>;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  append(path: string, content: Buffer, flags?: string[], idate?: Date): Promise<unknown>;
  logout(): Promise<void>;
}

export type ImapFactory = (settings: Settings) => ImapClient;

const TIMEOUT_MS = 15_000;
const UNREACHABLE = ['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'];
// Used only when the server does not mark its Sent folder.
const SENT_NAME = /^(inbox[./])?sent( items| messages| mail)?$/i;

/** The receiving server usually mirrors the sending one: smtpout.secureserver.net → imap.secureserver.net. */
export function imapHostFor(settings: Settings): string {
  return settings.imapHost ?? settings.host.replace(/^(smtpout|smtp)\./, 'imap.');
}

export const createImapClient: ImapFactory = (settings) =>
  new ImapFlow({
    host: imapHostFor(settings),
    port: 993,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  });

export function describeImapError(error: unknown, host: string): string {
  const { authenticationFailed, code, responseText, message } = (error ?? {}) as {
    authenticationFailed?: boolean;
    code?: string;
    responseText?: string;
    message?: string;
  };
  if (authenticationFailed) return `${host} refused the email address or password`;
  if (code && UNREACHABLE.includes(code)) return `could not reach ${host}`;
  return responseText || message || 'unknown error';
}

export async function findSentFolder(client: ImapClient): Promise<string | undefined> {
  const folders = await client.list();
  return (folders.find((folder) => folder.specialUse === '\\Sent') ?? folders.find((folder) => SENT_NAME.test(folder.path)))
    ?.path;
}

async function quietLogout(client: ImapClient) {
  try {
    await client.logout();
  } catch {
    // The connection is gone either way.
  }
}

/**
 * Files copies of sent emails in the mailbox's Sent folder over one IMAP
 * connection, opened on first use. It never throws: a copy that cannot be
 * saved does not undo a delivered email, so it becomes a warning instead.
 * Only APPEND is used; messages in the mailbox are never read.
 */
export function sentFolderSaver(settings: Settings, factory: ImapFactory = createImapClient) {
  const host = imapHostFor(settings);
  let opening: Promise<{ client: ImapClient; path: string }> | null = null;

  // A failed connection is not retried for every email in the same batch.
  const open = () =>
    (opening ??= (async () => {
      const client = factory(settings);
      await client.connect();
      const path = await findSentFolder(client);
      if (!path) {
        await quietLogout(client);
        throw new Error('no Sent folder was found in the mailbox');
      }
      return { client, path };
    })());

  return {
    async save(raw: Buffer): Promise<SaveReport> {
      try {
        const { client, path } = await open();
        await client.append(path, raw, ['\\Seen'], new Date());
        return { savedToSent: true };
      } catch (error) {
        return { savedToSent: false, warning: `Sent, but not copied to the Sent folder: ${describeImapError(error, host)}` };
      }
    },

    async close(): Promise<void> {
      if (!opening) return;
      try {
        await quietLogout((await opening).client);
      } catch {
        // Opening failed; that was already reported.
      }
    },
  };
}

export type SentFolderSaver = ReturnType<typeof sentFolderSaver>;

/** A sentence for the connection screen saying whether copies will reach the Sent folder. */
export async function describeSentFolder(settings: Settings, factory: ImapFactory = createImapClient): Promise<string> {
  const host = imapHostFor(settings);
  const client = factory(settings);
  try {
    await client.connect();
    const path = await findSentFolder(client);
    return path
      ? `Copies of sent emails will be saved to the "${path}" folder.`
      : 'Copies of sent emails cannot be saved: no Sent folder was found in the mailbox.';
  } catch (error) {
    return `Copies of sent emails cannot be saved to the Sent folder: ${describeImapError(error, host)}.`;
  } finally {
    await quietLogout(client);
  }
}
