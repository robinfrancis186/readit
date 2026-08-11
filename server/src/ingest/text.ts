const BLOCK_TAGS =
  /<\/?(p|div|br|h[1-6]|li|tr|td|th|section|article|blockquote|pre|figcaption|hr)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Flatten an (X)HTML document to plain text, keeping paragraph breaks so that
 * excerpt context and search snippets stay readable.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\?[\s\S]*?\?>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(BLOCK_TAGS, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
