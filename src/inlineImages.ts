export interface InlineImage {
  contentId: string;
  contentType: string;
  contentBytes: string;
}

/**
 * Mail clients block `data:` image URLs, so uploaded images are moved out of
 * the HTML and referenced as `cid:` attachments instead.
 */
export function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = [];
  const ids = new Map<string, string>();

  const rewritten = html.replace(
    /src="data:(image\/[a-z]+);base64,([^"]+)"/g,
    (_match, contentType: string, contentBytes: string) => {
      let contentId = ids.get(contentBytes);
      if (!contentId) {
        contentId = `image${images.length + 1}`;
        ids.set(contentBytes, contentId);
        images.push({ contentId, contentType, contentBytes });
      }
      return `src="cid:${contentId}"`;
    },
  );

  return { html: rewritten, images };
}
