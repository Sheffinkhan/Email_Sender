import nodemailer from 'nodemailer';
import { extractInlineImages } from './inlineImages.js';
import type { Recipient } from './recipients.js';
import { NotConfiguredError, SettingsError, type Settings } from './settings.js';

export interface OutgoingMail {
  to: Recipient;
  subject: string;
  html: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

/** The part of nodemailer this module uses, so tests can supply a fake. */
export interface Mailer {
  verify(): Promise<unknown>;
  sendMail(message: Record<string, unknown>): Promise<unknown>;
}

export type MailerFactory = (settings: Settings) => Mailer;

const TIMEOUT_MS = 15_000;
const UNREACHABLE = ['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'];

export const createMailer: MailerFactory = (settings) =>
  nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is encrypted from the first byte. 587 starts plain and must upgrade.
    secure: settings.port === 465,
    requireTLS: true,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  });

/** Turns a mail server failure into a sentence a non-technical user can act on. */
export function describeSmtpError(error: unknown): string {
  const { code, responseCode, message } = (error ?? {}) as {
    code?: string;
    responseCode?: number;
    message?: string;
  };
  if (code === 'EAUTH' || responseCode === 535) {
    return "The mail server refused the email address or password. Use the mailbox's own password, not the password of your GoDaddy account, and check the email provider is right.";
  }
  if (code && UNREACHABLE.includes(code)) {
    return 'Could not reach the mail server. Check the sending server, the port and your internet connection.';
  }
  return message ? `The mail server said: ${message}` : 'The mail server rejected the request';
}

/** Logs in without sending anything, to prove the details work before they are saved. */
export async function verifyConnection(settings: Settings, factory: MailerFactory = createMailer) {
  try {
    await factory(settings).verify();
  } catch (error) {
    throw new SettingsError(describeSmtpError(error));
  }
}

export function createSmtpTransport(
  loadSettings: () => Promise<Settings | null>,
  factory: MailerFactory = createMailer,
): MailTransport {
  return {
    async send(mail) {
      const settings = await loadSettings();
      if (!settings) throw new NotConfiguredError('Connect your email account first');

      const { html, images } = extractInlineImages(mail.html);
      try {
        await factory(settings).sendMail({
          from: { name: settings.fromName, address: settings.user },
          to: { name: mail.to.name, address: mail.to.email },
          subject: mail.subject,
          html,
          attachments: images.map((image) => ({
            filename: `${image.contentId}.${image.contentType.split('/')[1]}`,
            content: image.contentBytes,
            encoding: 'base64',
            contentType: image.contentType,
            cid: image.contentId,
          })),
        });
      } catch (error) {
        throw new Error(describeSmtpError(error));
      }
    },
  };
}
