import type { Recipient } from './recipients.js';

export interface Template {
  id: string;
  name: string;
  brandName: string;
  logoUrl: string;
  bannerUrl: string;
  accentColor: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  details: string;
  panelTitle: string;
  panelText: string;
  footer: string;
}

const DEFAULT_ACCENT = '#2563eb';
const NAME_FALLBACK = 'there';
const TEXT_COLOR = '#1f2937';
const FONT = 'Arial,Helvetica,sans-serif';

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

export function safeLink(url: string): string {
  const value = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : '';
}

export function safeImage(url: string): string {
  const value = url.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : '';
}

export function safeColor(color: string): string {
  const value = color.trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_ACCENT;
}

/** Fills `{{name}}` and `{{email}}` for one recipient. */
export function personalise(text: string, recipient: Recipient): string {
  return text.replace(/\{\{\s*(name|email)\s*\}\}/gi, (_match, key: string) =>
    key.toLowerCase() === 'email' ? recipient.email : recipient.name || NAME_FALLBACK,
  );
}

export function renderSubject(subject: string, recipient: Recipient): string {
  return personalise(subject, recipient).replace(/\s+/g, ' ').trim();
}

// Supports [text](url) links and **bold**. Everything else is escaped.
function inline(text: string, linkStyle: string): string {
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*/g;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    out += escapeHtml(text.slice(last, match.index));
    if (match[3] !== undefined) {
      out += `<strong>${escapeHtml(match[3])}</strong>`;
    } else {
      const href = safeLink(match[2]);
      const label = escapeHtml(match[1]);
      out += href ? `<a href="${escapeHtml(href)}" style="${linkStyle}">${label}</a>` : label;
    }
    last = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

// Blank lines split paragraphs. A block starting with "## " is a heading.
function blocks(text: string, color: string, linkStyle: string, fontSize = 14): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      block.startsWith('## ')
        ? `<h2 style="margin:24px 0 8px;font-size:18px;line-height:24px;color:${color};">${inline(block.slice(3), linkStyle)}</h2>`
        : `<p style="margin:0 0 16px;font-size:${fontSize}px;line-height:${fontSize + 8}px;color:${color};">${inline(block, linkStyle).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n');
}

function row(style: string, content: string, attrs = ''): string {
  return `<tr><td ${attrs} style="${style}">${content}</td></tr>`;
}

/** Renders the full HTML email for one recipient. Empty sections are left out. */
export function renderEmail(template: Template, recipient: Recipient): string {
  const fill = (text: string) => personalise(text, recipient);
  const accent = safeColor(template.accentColor);
  const bodyLink = `color:${accent};text-decoration:underline;`;
  const lightLink = 'color:#ffffff;text-decoration:underline;';
  const brand = escapeHtml(template.brandName.trim());
  const logo = safeImage(template.logoUrl);
  const banner = safeImage(template.bannerUrl);
  const buttonUrl = safeLink(template.buttonUrl);
  const heading = fill(template.heading).trim();
  const rows: string[] = [];

  if (logo) {
    rows.push(
      row(
        'padding:28px 32px 20px;',
        `<img src="${escapeHtml(logo)}" alt="${brand}" style="max-height:48px;max-width:240px;border:0;">`,
        'align="center"',
      ),
    );
  } else if (brand) {
    rows.push(
      row(
        'padding:28px 32px 20px;font-size:26px;font-weight:bold;color:#111827;',
        brand,
        'align="center"',
      ),
    );
  }

  if (banner) {
    rows.push(
      row(
        'padding:0;',
        `<img src="${escapeHtml(banner)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`,
      ),
    );
  }

  if (heading) {
    rows.push(
      row(
        `padding:32px 32px 12px;font-size:18px;line-height:26px;font-weight:bold;color:${TEXT_COLOR};`,
        inline(heading, bodyLink),
      ),
    );
  }

  if (template.intro.trim()) {
    rows.push(row('padding:8px 32px 0;', blocks(fill(template.intro), TEXT_COLOR, bodyLink)));
  }

  if (buttonUrl && template.buttonLabel.trim()) {
    rows.push(
      row(
        'padding:12px 32px 28px;',
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${accent}" style="border-radius:4px;">` +
          `<a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(fill(template.buttonLabel).trim())}</a>` +
          '</td></tr></table>',
        'align="center"',
      ),
    );
  }

  if (template.details.trim()) {
    rows.push(row('padding:0 32px 16px;', blocks(fill(template.details), TEXT_COLOR, bodyLink)));
  }

  if (template.panelTitle.trim() || template.panelText.trim()) {
    const title = template.panelTitle.trim()
      ? `<p style="margin:0 0 12px;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;">${inline(fill(template.panelTitle).trim(), lightLink)}</p>`
      : '';
    rows.push(
      row(
        'padding:28px 32px 12px;',
        title + blocks(fill(template.panelText), '#ffffff', lightLink, 13),
        `bgcolor="${accent}"`,
      ),
    );
  }

  if (template.footer.trim()) {
    rows.push(
      row(
        'padding:24px 32px;',
        blocks(fill(template.footer), '#6b7280', 'color:#6b7280;text-decoration:underline;', 11),
        'align="center"',
      ),
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;font-family:${FONT};">
${rows.join('\n')}
</table>
</td></tr>
</table>
</body>
</html>`;
}
