import { describe, expect, it, vi } from 'vitest';
import {
  createImapClient,
  describeImapError,
  describeSentFolder,
  findSentFolder,
  imapHostFor,
  sentFolderSaver,
  type ImapClient,
} from '../src/sentFolder.js';
import type { Settings } from '../src/settings.js';

const SETTINGS: Settings = {
  host: 'smtpout.secureserver.net',
  port: 465,
  user: 'info@acme.test',
  password: 'not-a-real-password',
  fromName: 'Acme',
};
const RAW = Buffer.from('From: info@acme.test\r\n\r\nHi');

function fakeImap(folders: { path: string; specialUse?: string }[] = [{ path: 'INBOX' }, { path: 'Sent Items', specialUse: '\\Sent' }]) {
  const client = {
    connect: vi.fn(async () => {}),
    list: vi.fn(async () => folders),
    append: vi.fn(async () => ({})),
    logout: vi.fn(async () => {}),
  };
  return { client, factory: vi.fn((_settings: Settings) => client as ImapClient) };
}

describe('imapHostFor', () => {
  it('mirrors the sending server', () => {
    expect(imapHostFor(SETTINGS)).toBe('imap.secureserver.net');
    expect(imapHostFor({ ...SETTINGS, host: 'smtp.titan.email' })).toBe('imap.titan.email');
    expect(imapHostFor({ ...SETTINGS, host: 'mail.acme.test' })).toBe('mail.acme.test');
  });

  it('prefers an explicit receiving server', () => {
    expect(imapHostFor({ ...SETTINGS, imapHost: 'imap.elsewhere.test' })).toBe('imap.elsewhere.test');
  });
});

describe('createImapClient', () => {
  it('connects securely to the receiving server with the mailbox login', () => {
    const client = createImapClient(SETTINGS) as unknown as { options: Record<string, unknown> };
    expect(client.options).toMatchObject({
      host: 'imap.secureserver.net',
      port: 993,
      secure: true,
      auth: { user: 'info@acme.test', pass: 'not-a-real-password' },
    });
  });
});

describe('findSentFolder', () => {
  it('prefers the folder the server marks as Sent', async () => {
    const { client } = fakeImap([{ path: 'Sent' }, { path: 'Gesendet', specialUse: '\\Sent' }]);
    expect(await findSentFolder(client)).toBe('Gesendet');
  });

  it('falls back to common names', async () => {
    for (const path of ['Sent', 'Sent Items', 'INBOX.Sent', 'INBOX/Sent Messages', 'sent mail']) {
      expect(await findSentFolder(fakeImap([{ path: 'INBOX' }, { path }]).client)).toBe(path);
    }
    expect(await findSentFolder(fakeImap([{ path: 'INBOX' }, { path: 'Sent by robots' }]).client)).toBeUndefined();
  });
});

describe('describeImapError', () => {
  it('words common failures plainly', () => {
    expect(describeImapError({ authenticationFailed: true }, 'imap.x.test')).toBe(
      'imap.x.test refused the email address or password',
    );
    expect(describeImapError({ code: 'ENOTFOUND' }, 'imap.x.test')).toBe('could not reach imap.x.test');
    expect(describeImapError({ responseText: 'Mailbox is full' }, 'imap.x.test')).toBe('Mailbox is full');
    expect(describeImapError(new Error('boom'), 'imap.x.test')).toBe('boom');
    expect(describeImapError(undefined, 'imap.x.test')).toBe('unknown error');
  });
});

describe('sentFolderSaver', () => {
  it('files each copy as read in the Sent folder over one connection', async () => {
    const { client, factory } = fakeImap();
    const saver = sentFolderSaver(SETTINGS, factory);
    expect(await saver.save(RAW)).toEqual({ savedToSent: true });
    expect(await saver.save(RAW)).toEqual({ savedToSent: true });
    await saver.close();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.append).toHaveBeenCalledWith('Sent Items', RAW, ['\\Seen'], expect.any(Date));
    expect(client.logout).toHaveBeenCalledTimes(1);
  });

  it('turns a refused login into a warning, once per batch', async () => {
    const { client, factory } = fakeImap();
    client.connect.mockRejectedValue({ authenticationFailed: true });
    const saver = sentFolderSaver(SETTINGS, factory);
    const warning = {
      savedToSent: false,
      warning: 'Sent, but not copied to the Sent folder: imap.secureserver.net refused the email address or password',
    };
    expect(await saver.save(RAW)).toEqual(warning);
    expect(await saver.save(RAW)).toEqual(warning);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await expect(saver.close()).resolves.toBeUndefined();
  });

  it('warns when the mailbox has no Sent folder', async () => {
    const { client, factory } = fakeImap([{ path: 'INBOX' }]);
    const saver = sentFolderSaver(SETTINGS, factory);
    expect((await saver.save(RAW)).warning).toMatch(/no Sent folder was found/);
    expect(client.logout).toHaveBeenCalledTimes(1);
  });

  it('warns when one copy fails and keeps going', async () => {
    const { client, factory } = fakeImap();
    client.append.mockRejectedValueOnce({ responseText: 'Over quota' });
    const saver = sentFolderSaver(SETTINGS, factory);
    expect(await saver.save(RAW)).toEqual({ savedToSent: false, warning: 'Sent, but not copied to the Sent folder: Over quota' });
    expect(await saver.save(RAW)).toEqual({ savedToSent: true });
  });

  it('does nothing on close when it was never used', async () => {
    const { factory } = fakeImap();
    await sentFolderSaver(SETTINGS, factory).close();
    expect(factory).not.toHaveBeenCalled();
  });

  it('ignores a logout that fails', async () => {
    const { client, factory } = fakeImap();
    client.logout.mockRejectedValue(new Error('socket closed'));
    const saver = sentFolderSaver(SETTINGS, factory);
    await saver.save(RAW);
    await expect(saver.close()).resolves.toBeUndefined();
  });
});

describe('describeSentFolder', () => {
  it('names the folder copies will go to', async () => {
    const { client, factory } = fakeImap();
    expect(await describeSentFolder(SETTINGS, factory)).toBe(
      'Copies of sent emails will be saved to the "Sent Items" folder.',
    );
    expect(client.logout).toHaveBeenCalled();
  });

  it('says when there is no Sent folder', async () => {
    expect(await describeSentFolder(SETTINGS, fakeImap([{ path: 'INBOX' }]).factory)).toMatch(/no Sent folder was found/);
  });

  it('says why copies cannot be saved', async () => {
    const { client, factory } = fakeImap();
    client.connect.mockRejectedValue({ code: 'ETIMEDOUT' });
    expect(await describeSentFolder(SETTINGS, factory)).toBe(
      'Copies of sent emails cannot be saved to the Sent folder: could not reach imap.secureserver.net.',
    );
  });
});
