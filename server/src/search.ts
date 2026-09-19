/** Quote tokens so user punctuation can never become FTS operators. */
export function ftsQuery(raw: string): string {
  return (raw.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).map((word) => `"${word}"*`).join(' AND ');
}
