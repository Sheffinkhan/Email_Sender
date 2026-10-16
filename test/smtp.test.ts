import { describe, expect, it, vi } from 'vitest';
import { sendToAll } from '../src/mailer.js';
import { NotConfiguredError, SettingsError, type Settings } from '../src/settings.js';
import {
  composeMessage,
  createMailer,
  createSmtpTransport,
  describeSmtpError,
  verifyConnection,
} from '../src/smtp.js';
import { normaliseTemplate } from '../src/templateStore.js';

const SETTINGS: Settings = {
  host: 'smtp.titan.email',
  port: 465,
  user: 'info@acme.test',
  password: 'not-a-real-password',
  fromName: 'Acme',
};

function fakeMailer() {
  const mailer = { verify: vi.fn(async () => true), sendMail: vi.fn(async () => ({})) };
  return { mailer, factory: vi.fn(() => mailer) };
}

describe('createMailer', () => {
  it('uses implicit TLS on 465 and forces STARTTLS on 587', () => {
    const implicit = createMailer(SETTINGS) as unknown as { options: Record<string, unknown> };
    expect(implicit.options).toMatchObject({
      host: 'smtp.titan.email',
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: 'info@acme.test', pass: 'not-a-real-password' },
    });

    const upgraded = createMailer({ ...SETTINGS, port: 587 }) as unknown as { options: Record<string, unknown> };
    expect(upgraded.options).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
});

describe('describeSmtpError', () => {
  it('explains a refused login', () => {
    expect(describeSmtpError({ code: 'EAUTH' })).toMatch(/refused the email address or password/);
    expect(describeSmtpError({ responseCode: 535 })).toMatch(/refused the email address or password/);
  });

  it('explains an unreachable server', () => {
    for (const code of ['ESOCKET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']) {
      expect(describeSmtpError({ code })).toMatch(/Could not reach the mail server/);
    }
  });

  it('passes on what the server said otherwise', () => {
    expect(describeSmtpError(new Error('Mailbox quota exceeded'))).toBe(
      'The mail server said: Mailbox quota exceeded',
    );
    expect(describeSmtpError(undefined)).toBe('The mail server rejected the request');
  });
});

describe('verifyConnection', () => {
  it('logs in with the given settings', async () => {
    const { mailer, factory } = fakeMailer();
    await verifyConnection(SETTINGS, factory);
    expect(factory).toHaveBeenCalledWith(SETTINGS);
    expect(mailer.verify).toHaveBeenCalled();
  });

  it('reports a failed login as a settings problem', async () => {
    const { mailer, factory } = fakeMailer();
    mailer.verify.mockRejectedValue({ code: 'EAUTH' });
    await expect(verifyConnection(SETTINGS, factory)).rejects.toThrow(SettingsError);
  });
});

describe('smtp transport', () => {
  const mail = {
    to: { email: 'anna@client.com', name: 'Anna' },
    subject: 'Welcome',
    html: '<img src="data:image/gif;base64,AAAA"><p>Hi</p>',
  };

  function fakeImap(folders: { path: string; specialUse?: string }[] = [{ path: 'INBOX' }, { path: 'Sent Items', specialUse: '\\Sent' }]) {
    const client = {
      connect: vi.fn(async () => {}),
      list: vi.fn(async () => folders),
      append: vi.fn(async () => ({})),
      logout: vi.fn(async () => {}),
    };
    return { client, factory: vi.fn(() => client) };
  }

  it('composes the full message from the connected mailbox with uploads attached inline', async () => {
    const raw = (await composeMessage(SETTINGS, mail)).toString();
    expect(raw).toMatch(/^From: Acme <info@acme\.test>\r?$/m);
    expect(raw).toMatch(/^To: Anna <anna@client\.com>\r?$/m);
    expect(raw).toMatch(/^Subject: Welcome\r?$/m);
    expect(raw).toMatch(/^Message-ID: </m);
    expect(raw).toMatch(/src=(3D)?"cid:image1"/);
    expect(raw).toMatch(/^Content-ID: <image1>\r?$/m);
    expect(raw).toMatch(/^Content-Type: image\/gif; name=image1\.gif\r?$/m);
  });

  it('delivers exactly the message it files in Sent', async () => {
    const { mailer, factory } = fakeMailer();
    const imap = fakeImap();
    const session = await createSmtpTransport(async () => SETTINGS, factory, imap.factory).open();

    expect(await session.send(mail)).toEqual({ savedToSent: true });
    await session.send({ ...mail, to: { email: 'ben@client.com', name: '' } });
    await session.close();

    expect(factory).toHaveBeenCalledWith(SETTINGS);
    const [first] = mailer.sendMail.mock.calls[0] as unknown as [{ envelope: unknown; raw: Buffer }];
    expect(first.envelope).toEqual({ from: 'info@acme.test', to: ['anna@client.com'] });
    const [folder, copy, flags] = imap.client.append.mock.calls[0] as unknown as [string, Buffer, string[]];
    expect(folder).toBe('Sent Items');
    expect(copy).toBe(first.raw);
    expect(flags).toEqual(['\\Seen']);
    // One mailbox connection for the whole batch.
    expect(imap.factory).toHaveBeenCalledTimes(1);
    expect(imap.client.append).toHaveBeenCalledTimes(2);
    expect(imap.client.logout).toHaveBeenCalledTimes(1);
  });

  it('refuses to start before an account is connected', async () => {
    const { mailer, factory } = fakeMailer();
    await expect(createSmtpTransport(async () => null, factory).open()).rejects.toThrow(NotConfiguredError);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('explains why the server rejected a message, and files no copy', async () => {
    const { mailer, factory } = fakeMailer();
    const imap = fakeImap();
    mailer.sendMail.mockRejectedValue(new Error('550 Recipient address rejected'));
    const session = await createSmtpTransport(async () => SETTINGS, factory, imap.factory).open();
    await expect(session.send(mail)).rejects.toThrow('The mail server said: 550 Recipient address rejected');
    await session.close();
    expect(imap.factory).not.toHaveBeenCalled();
  });
});

describe('sendToAll', () => {
  it('sends one personalised email each, keeps going after a failure, and closes the session', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ savedToSent: true })
      .mockRejectedValueOnce(new Error('Mailbox full'))
      .mockRejectedValueOnce('odd failure')
      .mockResolvedValueOnce({ savedToSent: false, warning: 'Sent, but not copied to the Sent folder: x' });
    const close = vi.fn(async () => {});
    const template = normaliseTemplate({ name: 'Welcome', heading: 'Hi {{name}}' });
    const recipients = [
      { email: 'anna@client.com', name: 'Anna' },
      { email: 'ben@client.com', name: '' },
      { email: 'cy@client.com', name: 'Cy' },
      { email: 'di@client.com', name: 'Di' },
    ];

    const results = await sendToAll(template, 'Hello {{name}}', recipients, { open: async () => ({ send, close }) });

    expect(results).toEqual([
      { email: 'anna@client.com', ok: true },
      { email: 'ben@client.com', ok: false, error: 'Mailbox full' },
      { email: 'cy@client.com', ok: false, error: 'odd failure' },
      { email: 'di@client.com', ok: true, warning: 'Sent, but not copied to the Sent folder: x' },
    ]);
    expect(send.mock.calls[0][0]).toMatchObject({ to: recipients[0], subject: 'Hello Anna' });
    expect(send.mock.calls[0][0].html).toContain('Hi Anna');
    expect(send.mock.calls[1][0]).toMatchObject({ subject: 'Hello there' });
    expect(send.mock.calls[1][0].html).not.toContain('Anna');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
