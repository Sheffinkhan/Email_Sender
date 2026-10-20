import type { MailTransport } from './smtp.js';
import type { Recipient } from './recipients.js';
import { renderEmail, renderSubject, renderText, type Template } from './render.js';

export interface SendResult {
  email: string;
  ok: boolean;
  error?: string;
  /** Delivered, but something smaller went wrong, such as the Sent copy. */
  warning?: string;
}

/**
 * Sends one separate, personalised email per recipient. A failure for one
 * recipient is recorded and does not stop the rest. Each delivered email is
 * also filed in the mailbox's Sent folder.
 */
export async function sendToAll(
  template: Template,
  subject: string,
  recipients: Recipient[],
  transport: MailTransport,
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  const session = await transport.open();
  try {
    for (const to of recipients) {
      try {
        const report = await session.send({
          to,
          subject: renderSubject(subject, to),
          html: renderEmail(template, to),
          text: renderText(template, to),
        });
        results.push({ email: to.email, ok: true, ...(report.warning && { warning: report.warning }) });
      } catch (error) {
        results.push({
          email: to.email,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await session.close();
  }
  return results;
}
