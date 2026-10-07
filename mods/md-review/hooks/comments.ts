// Pure helpers for <!-- REVIEW @handle YYYY-MM-DD: text --> comments.

export type ReviewComment = { author: string; date: string; text: string }

const COMMENT = /^\s*<!-- REVIEW (@\S+) (\d{4}-\d{2}-\d{2}): ([\s\S]*?) -->\s*$/

export function parseComment(line: string): ReviewComment | undefined {
  const match = COMMENT.exec(line)
  if (!match) return undefined
  return { author: match[1]!, date: match[2]!, text: match[3]! }
}

export function formatComment(handle: string, date: string, text: string): string {
  // `-->` would close the HTML comment early.
  const safe = text.trim().replace(/-->/g, '-- >')
  return `<!-- REVIEW @${handle.replace(/^@/, '')} ${date}: ${safe} -->`
}

export function localDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function splitLines(text: string): { lines: string[]; eol: string } {
  return { lines: text.split(/\r?\n/), eol: text.includes('\r\n') ? '\r\n' : '\n' }
}

/** Index the new comment for `line` goes to: below the line and any review comments already under it. */
export function insertionIndex(lines: readonly string[], line: number): number {
  let at = line + 1
  while (at < lines.length && parseComment(lines[at]!) !== undefined) at += 1
  return at
}

export function addComment(lines: readonly string[], line: number, comment: string): string[] {
  const at = insertionIndex(lines, line)
  return [...lines.slice(0, at), comment, ...lines.slice(at)]
}

/** Replaces the comment at `line`, or removes it when `comment` is undefined. */
export function replaceComment(lines: readonly string[], line: number, comment: string | undefined): string[] {
  return comment === undefined
    ? [...lines.slice(0, line), ...lines.slice(line + 1)]
    : [...lines.slice(0, line), comment, ...lines.slice(line + 1)]
}

export function countComments(lines: readonly string[]): number {
  return lines.filter(line => parseComment(line) !== undefined).length
}
