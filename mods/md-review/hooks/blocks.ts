// Splits markdown source into the blocks a review comment may follow: a comment
// is only ever inserted after a whole block, never inside a table, a code
// fence or the front matter.

import { parseComment } from './comments'

export type BlockKind =
  | 'frontmatter'
  | 'code'
  | 'heading'
  | 'table'
  | 'list'
  | 'quote'
  | 'html'
  | 'rule'
  | 'paragraph'
  | 'comment'

/** Lines `start`..`end` inclusive; `indent` is the first line's leading spaces. */
export type Block = { kind: BlockKind; start: number; end: number; indent: number }

const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^\s{0,3}#{1,6}(\s|$)/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const TABLE = /^\s*\|/
const QUOTE = /^\s{0,3}>/
const HTML = /^\s{0,3}<\/?[A-Za-z!]/

const isBlank = (line: string) => line.trim() === ''
const indentOf = (line: string) => line.length - line.trimStart().length

/** Whether `line` begins a block of its own, ending a paragraph or list item before it. */
function startsBlock(line: string): boolean {
  return (
    parseComment(line) !== undefined ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    LIST.test(line) ||
    RULE.test(line) ||
    TABLE.test(line) ||
    QUOTE.test(line) ||
    HTML.test(line)
  )
}

export function splitBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  const at = (i: number) => lines[i] ?? ''
  let i = 0

  if (at(0).trim() === '---') {
    let end = 1
    while (end < lines.length && at(end).trim() !== '---') end += 1
    if (end < lines.length) {
      blocks.push({ kind: 'frontmatter', start: 0, end, indent: 0 })
      i = end + 1
    }
  }

  while (i < lines.length) {
    const line = at(i)
    const start = i
    const indent = indentOf(line)
    const push = (kind: BlockKind, end: number) => {
      blocks.push({ kind, start, end, indent })
      i = end + 1
    }
    const runWhile = (test: (l: string) => boolean) => {
      let end = i
      while (end + 1 < lines.length && test(at(end + 1)) && parseComment(at(end + 1)) === undefined) end += 1
      return end
    }

    if (isBlank(line)) {
      i += 1
    } else if (parseComment(line)) {
      push('comment', i)
    } else if (FENCE.test(line)) {
      const fence = FENCE.exec(line)![1]!
      let end = i + 1
      while (end < lines.length && !at(end).trim().startsWith(fence)) end += 1
      push('code', Math.min(end, lines.length - 1))
    } else if (HEADING.test(line)) {
      push('heading', i)
    } else if (RULE.test(line)) {
      push('rule', i)
    } else if (TABLE.test(line)) {
      push('table', runWhile(l => TABLE.test(l)))
    } else if (QUOTE.test(line)) {
      push('quote', runWhile(l => !isBlank(l)))
    } else if (LIST.test(line)) {
      // The item and its continuation lines, up to a blank line or the next item.
      push('list', runWhile(l => !isBlank(l) && !startsBlock(l)))
    } else if (HTML.test(line)) {
      push('html', runWhile(l => !isBlank(l) && !startsBlock(l)))
    } else {
      push('paragraph', runWhile(l => !isBlank(l) && !startsBlock(l)))
    }
  }
  return blocks
}

/** The block holding `line`, if any (blank lines belong to none). */
export function blockAt(blocks: readonly Block[], line: number): Block | undefined {
  return blocks.find(block => block.start <= line && line <= block.end)
}

/**
 * The line a comment on `line` is placed after: the end of its block, so it
 * never lands inside a table, code fence or front matter.
 */
export function anchorFor(blocks: readonly Block[], line: number): number {
  return blockAt(blocks, line)?.end ?? line
}

/** Leading spaces a comment after `block` gets: a list item's content column, so the list is not cut in two. */
export function commentIndent(block: Block | undefined, lines: readonly string[]): string {
  if (block?.kind !== 'list') return ''
  const match = LIST.exec(lines[block.start] ?? '')
  return match ? ' '.repeat(match[1]!.length + match[2]!.length + 1) : ''
}

/** The block's source with its first line's indentation removed, for drawing as markdown. */
export function blockSource(block: Block, lines: readonly string[]): string {
  return lines
    .slice(block.start, block.end + 1)
    .map(line => line.slice(Math.min(block.indent, indentOf(line))))
    .join('\n')
}
