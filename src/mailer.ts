import type { MailTransport } from './graph/transport.js';
import type { Recipient } from './recipients.js';
import { renderEmail, renderSubject, type Template } from './render.js';

export interface SendResult {
  email: string;
  ok: boolean;
  error?: string;
}

/**
 * Sends one separate, personalised email per recipient. A failure for one
 * recipient is recorded and does not stop the rest.
 */
export async function sendToAll(
  template: Template,
  subject: string,
  recipients: Recipient[],
  transport: MailTransport,
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const to of recipients) {
    try {
      await transport.send({
        to,
        subject: renderSubject(subject, to),
        html: renderEmail(template, to),
      });
      results.push({ email: to.email, ok: true });
    } catch (error) {
      results.push({
        email: to.email,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
