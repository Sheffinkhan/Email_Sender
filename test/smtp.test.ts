import { describe, expect, it, vi } from 'vitest';
import { sendToAll } from '../src/mailer.js';
import { NotConfiguredError, SettingsError, type Settings } from '../src/settings.js';
import { createMailer, createSmtpTransport, describeSmtpError, verifyConnection } from '../src/smtp.js';
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

  it('sends from the connected mailbox with uploads attached inline', async () => {
    const { mailer, factory } = fakeMailer();
    await createSmtpTransport(async () => SETTINGS, factory).send(mail);

    expect(factory).toHaveBeenCalledWith(SETTINGS);
    expect(mailer.sendMail).toHaveBeenCalledWith({
      from: { name: 'Acme', address: 'info@acme.test' },
      to: { name: 'Anna', address: 'anna@client.com' },
      subject: 'Welcome',
      html: '<img src="cid:image1"><p>Hi</p>',
      attachments: [
        {
          filename: 'image1.gif',
          content: 'AAAA',
          encoding: 'base64',
          contentType: 'image/gif',
          cid: 'image1',
        },
      ],
    });
  });

  it('refuses to send before an account is connected', async () => {
    const { mailer, factory } = fakeMailer();
    await expect(createSmtpTransport(async () => null, factory).send(mail)).rejects.toThrow(NotConfiguredError);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('explains why the server rejected a message', async () => {
    const { mailer, factory } = fakeMailer();
    mailer.sendMail.mockRejectedValue(new Error('550 Recipient address rejected'));
    await expect(createSmtpTransport(async () => SETTINGS, factory).send(mail)).rejects.toThrow(
      'The mail server said: 550 Recipient address rejected',
    );
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
