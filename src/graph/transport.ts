import { extractInlineImages } from '../inlineImages.js';
import type { Recipient } from '../recipients.js';

export interface OutgoingMail {
  to: Recipient;
  subject: string;
  html: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

const SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 30_000;

function retryDelay(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000;
  return Math.min(wait, MAX_RETRY_WAIT_MS);
}

async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return `Outlook rejected the message (${response.status}): ${body?.error?.message ?? response.statusText}`;
}

/** Sends through Microsoft Graph as the signed-in user. Copies land in Sent Items. */
export function createGraphTransport(
  getToken: () => Promise<string>,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): MailTransport {
  return {
    async send(mail) {
      const { html, images } = extractInlineImages(mail.html);
      const body = JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [
            { emailAddress: { address: mail.to.email, ...(mail.to.name && { name: mail.to.name }) } },
          ],
          attachments: images.map((image) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: `${image.contentId}.${image.contentType.split('/')[1]}`,
            contentType: image.contentType,
            contentBytes: image.contentBytes,
            contentId: image.contentId,
            isInline: true,
          })),
        },
        saveToSentItems: true,
      });

      for (let attempt = 1; ; attempt++) {
        const response = await fetchFn(SEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await getToken()}`,
            'Content-Type': 'application/json',
          },
          body,
        });
        if (response.ok) return;
        // Graph throttles bursts; it says how long to wait.
        if ((response.status === 429 || response.status === 503) && attempt < MAX_ATTEMPTS) {
          await sleep(retryDelay(response));
          continue;
        }
        throw new Error(await describeFailure(response));
      }
    },
  };
}
