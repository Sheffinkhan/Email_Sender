import type { Recipient } from './recipients.js';

/** The parts of an email, in their default top-to-bottom order. */
export const SECTIONS = [
  'logo',
  'banner',
  'heading',
  'intro',
  'media',
  'button',
  'details',
  'panel',
  'footer',
] as const;

export type SectionId = (typeof SECTIONS)[number];

/** Keeps known sections in the given order and appends any that are missing. */
export function normaliseOrder(input: unknown): SectionId[] {
  const given = Array.isArray(input)
    ? input.filter((id): id is SectionId => (SECTIONS as readonly unknown[]).includes(id))
    : [];
  return [...new Set([...given, ...SECTIONS])];
}

export interface Template {
  id: string;
  order: SectionId[];
  name: string;
  /** Pre-filled into the Subject box when the template is opened. Not part of the email body. */
  subject: string;
  brandName: string;
  logoUrl: string;
  bannerUrl: string;
  accentColor: string;
  heading: string;
  intro: string;
  mediaUrl: string;
  videoUrl: string;
  videoLabel: string;
  buttonLabel: string;
  buttonUrl: string;
  details: string;
  panelTitle: string;
  panelText: string;
  footer: string;
}

const DEFAULT_ACCENT = '#2563eb';
const NAME_FALLBACK = 'there';
const VIDEO_LABEL_FALLBACK = 'Watch the video';
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

/** Returns the preview picture YouTube hosts for a video link, or '' for other links. */
export function youtubeThumbnail(url: string): string {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    const host = hostname.replace(/^(www|m)\./, '');
    let id = '';
    if (host === 'youtu.be') id = pathname.slice(1);
    else if (host === 'youtube.com') {
      id = searchParams.get('v') ?? /^\/(shorts|embed|live)\/([^/]+)/.exec(pathname)?.[2] ?? '';
    }
    return /^[\w-]{11}$/.test(id) ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
  } catch {
    return '';
  }
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
  const sections: Partial<Record<SectionId, string>> = {};

  if (logo) {
    sections.logo = row(
      'padding:28px 32px 20px;',
      `<img src="${escapeHtml(logo)}" alt="${brand}" style="max-height:48px;max-width:240px;border:0;">`,
      'align="center"',
    );
  } else if (brand) {
    sections.logo = row(
      'padding:28px 32px 20px;font-size:26px;font-weight:bold;color:#111827;',
      brand,
      'align="center"',
    );
  }

  if (banner) {
    sections.banner = row(
      'padding:0;',
      `<img src="${escapeHtml(banner)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`,
    );
  }

  if (heading) {
    sections.heading = row(
      `padding:32px 32px 4px;font-size:18px;line-height:26px;font-weight:bold;color:${TEXT_COLOR};`,
      inline(heading, bodyLink),
    );
  }

  if (template.intro.trim()) {
    sections.intro = row('padding:16px 32px 0;', blocks(fill(template.intro), TEXT_COLOR, bodyLink));
  }

  // Mail clients do not play video, so a video is a linked picture plus a text link.
  const video = /^https?:\/\//i.test(template.videoUrl.trim()) ? escapeHtml(template.videoUrl.trim()) : '';
  const media = safeImage(template.mediaUrl) || youtubeThumbnail(template.videoUrl.trim());
  if (media || video) {
    const label = escapeHtml(fill(template.videoLabel).trim() || VIDEO_LABEL_FALLBACK);
    const picture = media
      ? `<img src="${escapeHtml(media)}" alt="${video ? label : ''}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;">`
      : '';
    const caption = video
      ? `<p style="margin:${media ? 12 : 0}px 0 0;font-size:14px;line-height:22px;font-weight:bold;"><a href="${video}" style="${bodyLink}">&#9654; ${label}</a></p>`
      : '';
    sections.media = row(
      'padding:12px 32px 20px;',
      (video && picture ? `<a href="${video}">${picture}</a>` : picture) + caption,
      'align="center"',
    );
  }

  if (buttonUrl && template.buttonLabel.trim()) {
    sections.button = row(
      'padding:12px 32px 20px;',
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${accent}" style="border-radius:4px;">` +
        `<a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(fill(template.buttonLabel).trim())}</a>` +
        '</td></tr></table>',
      'align="center"',
    );
  }

  if (template.details.trim()) {
    sections.details = row('padding:16px 32px 8px;', blocks(fill(template.details), TEXT_COLOR, bodyLink));
  }

  if (template.panelTitle.trim() || template.panelText.trim()) {
    const title = template.panelTitle.trim()
      ? `<p style="margin:0 0 12px;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;">${inline(fill(template.panelTitle).trim(), lightLink)}</p>`
      : '';
    sections.panel = row(
      'padding:28px 32px 12px;',
      title + blocks(fill(template.panelText), '#ffffff', lightLink, 13),
      `bgcolor="${accent}"`,
    );
  }

  if (template.footer.trim()) {
    sections.footer = row(
      'padding:24px 32px;',
      blocks(fill(template.footer), '#6b7280', 'color:#6b7280;text-decoration:underline;', 11),
      'align="center"',
    );
  }

  const rows = template.order.map((id) => sections[id]).filter(Boolean);

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

// [text](url) becomes "text (url)" and **bold** loses its stars; only safe links keep their address.
function inlineText(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
      safeLink(url) ? `${label} (${url})` : label,
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '$1');
}

function blocksText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => inlineText(block.startsWith('## ') ? block.slice(3) : block))
    .join('\n\n');
}

/**
 * The plain-text version sent alongside the HTML. Mail apps that do not show
 * HTML use it, and spam filters distrust messages that have no text part.
 */
export function renderText(template: Template, recipient: Recipient): string {
  const fill = (text: string) => personalise(text, recipient);
  const video = /^https?:\/\//i.test(template.videoUrl.trim()) ? template.videoUrl.trim() : '';
  const buttonUrl = safeLink(template.buttonUrl);
  const sections: Partial<Record<SectionId, string>> = {
    logo: template.brandName.trim(),
    heading: inlineText(fill(template.heading).trim()),
    intro: blocksText(fill(template.intro)),
    media: video ? `${fill(template.videoLabel).trim() || VIDEO_LABEL_FALLBACK}: ${video}` : '',
    button: buttonUrl && template.buttonLabel.trim() ? `${fill(template.buttonLabel).trim()}: ${buttonUrl}` : '',
    details: blocksText(fill(template.details)),
    panel: [inlineText(fill(template.panelTitle).trim()), blocksText(fill(template.panelText))].filter(Boolean).join('\n\n'),
    footer: blocksText(fill(template.footer)),
  };
  return `${template.order
    .map((id) => sections[id])
    .filter(Boolean)
    .join('\n\n')}\n`;
}
