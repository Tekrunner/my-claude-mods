import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { anchorFor, blockSource, commentIndent, splitBlocks } from '../hooks/blocks'
import { addComment, formatComment, parseComment, replaceComment } from '../hooks/comments'
import { age, filterFiles, isMarkdown, isSkippedFolder, matches } from '../hooks/files'

describe('comment helpers', () => {
  test('formats and parses a comment', () => {
    const line = formatComment('yfontana', '2026-10-07', 'This --> breaks')
    expect(line).toBe('<!-- REVIEW @yfontana 2026-10-07: This -- > breaks -->')
    expect(parseComment(line)).toEqual({ author: '@yfontana', date: '2026-10-07', text: 'This -- > breaks' })
    expect(parseComment('   ' + line)?.text).toBe('This -- > breaks')
    expect(parseComment('<!-- some other comment -->')).toBeUndefined()
  })

  test('adds below the line, after existing comments', () => {
    const first = formatComment('a', '2026-01-01', 'one')
    const lines = addComment(['x', first, 'y'], 0, 'NEW')
    expect(lines).toEqual(['x', first, 'NEW', 'y'])
  })

  test('replaces and deletes', () => {
    expect(replaceComment(['x', 'c', 'y'], 1, 'd')).toEqual(['x', 'd', 'y'])
    expect(replaceComment(['x', 'c', 'y'], 1, undefined)).toEqual(['x', 'y'])
  })
})

describe('file matching', () => {
  test('matches every word, ignoring case and slash direction', () => {
    expect(matches('docs/Plan-1-8.md', 'plan 1-8')).toBe(true)
    expect(matches('docs/Plan-1-8.md', 'docs\\plan')).toBe(true)
    expect(matches('docs/Plan-1-8.md', 'plan 1-9')).toBe(false)
  })

  test('lists newest first, and tells ages', () => {
    const files = [{ path: 'a.md', mtimeMs: 1 }, { path: 'b.md', mtimeMs: 2 }]
    expect(filterFiles(files, '').map(f => f.path)).toEqual(['b.md', 'a.md'])
    expect(age(0, 90 * 60000)).toBe('1h ago')
    expect(age(0, 30000)).toBe('just now')
  })

  test('skips hidden and build folders, keeps markdown only', () => {
    expect(isSkippedFolder('.git')).toBe(true)
    expect(isSkippedFolder('node_modules')).toBe(true)
    expect(isSkippedFolder('_bmad-output')).toBe(false)
    expect(isMarkdown('README.MD')).toBe(true)
    expect(isMarkdown('notes.txt')).toBe(false)
  })
})

describe('blocks', () => {
  const doc = [
    '---', //            0 front matter
    'title: x', //       1
    '---', //            2
    '', //               3
    '# Heading', //      4
    'Para one', //       5 paragraph
    'continues', //      6
    '', //               7
    '| a | b |', //      8 table
    '|---|---|', //      9
    '| 1 | 2 |', //      10
    '```sql', //         11 code
    '| not a table', //  12
    '```', //            13
    '- item one', //     14 list
    '  more of it', //   15
    '  - nested', //     16 nested list
    '1. numbered', //    17
    '<frozen>', //       18 html
  ]
  const blocks = splitBlocks(doc)

  test('splits into blocks', () => {
    expect(blocks.map(b => [b.kind, b.start, b.end])).toEqual([
      ['frontmatter', 0, 2],
      ['heading', 4, 4],
      ['paragraph', 5, 6],
      ['table', 8, 10],
      ['code', 11, 13],
      ['list', 14, 15],
      ['list', 16, 16],
      ['list', 17, 17],
      ['html', 18, 18],
    ])
  })

  test('anchors a comment after the whole block', () => {
    expect(anchorFor(blocks, 1)).toBe(2) // never inside front matter
    expect(anchorFor(blocks, 9)).toBe(10) // never inside a table
    expect(anchorFor(blocks, 12)).toBe(13) // never inside a code fence
    expect(anchorFor(blocks, 3)).toBe(3) // a blank line is its own anchor
  })

  test('indents a comment into its list item, and dedents nested items for drawing', () => {
    expect(commentIndent(blocks[5], doc)).toBe('  ')
    expect(commentIndent(blocks[7], doc)).toBe('   ')
    expect(commentIndent(blocks[2], doc)).toBe('')
    expect(blockSource(blocks[6]!, doc)).toBe('- nested')
  })
})

const PANE_PROPS = {
  title: 'Review',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

/**
 * Runs `/md-review <args>` over a project held in memory (standing for the disk):
 * doc.md holding `initial`, plus `others` by path, each newer than the last.
 * `text()` reads doc.md back; `edit` changes it as an editor elsewhere would.
 */
async function open(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop',
  initial: string,
  args = 'doc.md',
  others: Record<string, string> = {},
) {
  const disk = new Map<string, { text: string; mtimeMs: number }>([['doc.md', { text: initial, mtimeMs: 1 }]])
  Object.entries(others).forEach(([path, text], index) => disk.set(path, { text, mtimeMs: 100 + index }))
  // The engine hands hooks absolute paths: match them by their end.
  const norm = (p: string) => p.replace(/\\/g, '/')
  const fileAt = (p: string) => [...disk.keys()].find(k => norm(p) === k || norm(p).endsWith('/' + k))
  const folders = new Set([...disk.keys()].flatMap(k => k.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))
  const folderAt = (p: string) => [...folders].find(d => norm(p) === d || norm(p).endsWith('/' + d)) ?? ''

  on('fs.read', ($, e, next) => {
    const k = fileAt(e.path)
    return k === undefined ? next(e) : { value: disk.get(k)!.text }
  })
  on('fs.write', ($, e, next) => {
    const k = fileAt(e.path)
    if (k === undefined) return next(e)
    disk.set(k, { text: e.text, mtimeMs: disk.get(k)!.mtimeMs + 1 })
    return { value: undefined }
  })
  on('fs.stat', ($, e, next) => {
    const k = fileAt(e.path)
    if (k === undefined) return next(e)
    const { text, mtimeMs } = disk.get(k)!
    return { value: { kind: 'file', size: text.length, mtimeMs, isLink: false } }
  })
  on('fs.list', ($, e) => {
    const dir = folderAt(e.path ?? '')
    const prefix = dir === '' ? '' : dir + '/'
    const names = new Map<string, 'file' | 'dir'>()
    for (const k of disk.keys()) {
      if (!k.startsWith(prefix)) continue
      const [name, ...rest] = k.slice(prefix.length).split('/')
      names.set(name!, rest.length > 0 ? 'dir' : 'file')
    }
    return {
      value: [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: kind === 'file' ? disk.get(prefix + name)!.mtimeMs : 0,
        isLink: false,
      })),
    }
  })
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  const ran = await $.command.run({
    command: 'md-review',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  const ui = await $.ui.mount({ plugin: 'md-review', surface, component: 'Pane', requestId: 'md-review', props: PANE_PROPS })
  const edit = (next: string) => disk.set('doc.md', { text: next, mtimeMs: disk.get('doc.md')!.mtimeMs + 1 })
  return { ui, clock, edit, ran, text: () => disk.get('doc.md')!.text }
}

const COMMENT = (body: string) => new RegExp(`<!-- REVIEW @yfontana \\d{4}-\\d{2}-\\d{2}: ${body} -->`)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`source view: adds, edits and deletes a comment on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, text } = await open($, on, surface, '# Title\r\nFirst line\r\n')
    await ui.press({ key: 'mode' })

    await ui.press({ key: 'ln:1' })
    await ui.input({ key: 'comment', text: 'Too vague' })
    expect(text()).toMatch(/^# Title\r\nFirst line\r\n<!-- REVIEW @yfontana \d{4}-\d{2}-\d{2}: Too vague -->\r\n$/)

    await ui.press({ key: 'ln:2' })
    await ui.input({ key: 'comment', text: 'Too vague, say which API' })
    expect(text()).toMatch(COMMENT('Too vague, say which API'))

    await ui.press({ key: 'ln:2' })
    await ui.input({ key: 'comment', text: '' })
    expect(text()).toBe('# Title\r\nFirst line\r\n')

    await ui.unmount()
  })

  test(`source view: a comment inside a table goes after it on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, text } = await open($, on, surface, '| a |\n|---|\n| 1 |\nafter\n')
    await ui.press({ key: 'mode' })
    await ui.press({ key: 'ln:1' })
    await ui.input({ key: 'comment', text: 'Bad row' })
    expect(text().split('\n')[3]).toMatch(COMMENT('Bad row'))
    await ui.unmount()
  })

  test(`rendered view: comments on a block and edits the comment on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, text } = await open($, on, surface, '# Title\n\nPara one\ncontinues\n\n- item\n')

    await ui.press({ key: 'ln:2' })
    await ui.input({ key: 'comment', text: 'Rephrase' })
    expect(text().split('\n')[4]).toMatch(COMMENT('Rephrase'))

    await ui.press({ key: 'ln:6' })
    await ui.input({ key: 'comment', text: 'In the item' })
    expect(text().split('\n')[7]).toMatch(new RegExp('^  ' + COMMENT('In the item').source))

    await ui.press({ key: 'ln:4' })
    await ui.input({ key: 'comment', text: 'Rephrase it' })
    expect(text().split('\n')[4]).toMatch(COMMENT('Rephrase it'))

    await ui.unmount()
  })

  test(`reloads when the file changes elsewhere on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, clock, edit } = await open($, on, surface, 'one\n')
    // The poll starts with the session; a test raises that itself.
    await $.session.start({ cwd: '.', surface, isInteractive: true })
    expect(await ui.find({ key: 'ln:2' })).toBeUndefined()
    edit('one\n\ntwo\n')
    await clock.advance(2000)
    expect(await ui.find({ key: 'ln:2' })).toBeDefined()
    await ui.unmount()
  })

  const PROJECT = {
    'docs/plan-a.md': '# Plan A\n',
    'docs/notes.txt': 'not markdown\n',
    'node_modules/pkg/readme.md': '# skipped\n',
    '.git/info.md': '# skipped\n',
    'docs/plan-b.md': '# Plan B\n',
  }

  test(`a unique part of a name opens the file on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, ran } = await open($, on, surface, '# Doc\n', 'plan-a', PROJECT)
    expect(ran.text).toContain('Reviewing docs/plan-a.md')
    expect(await ui.find({ key: 'files' })).toBeDefined()
    await ui.unmount()
  })

  test(`several matches show the picker, newest first, on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui, ran } = await open($, on, surface, '# Doc\n', 'plan', PROJECT)
    expect(ran.text).toContain('2 markdown files match')
    expect((await ui.find({ key: 'file:0' }))?.text).toContain('docs/plan-b.md')
    expect((await ui.find({ key: 'file:1' }))?.text).toContain('docs/plan-a.md')
    expect(await ui.find({ key: 'file:2' })).toBeUndefined()
    await ui.press({ key: 'file:1' })
    expect(await ui.find({ key: 'files' })).toBeDefined()
    await ui.unmount()
  })

  test(`no argument lists every markdown file and filters as you type on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const { ui } = await open($, on, surface, '# Doc\n', '', PROJECT)
    // doc.md and the two plans; not notes.txt, nor anything under node_modules or .git.
    expect(await ui.find({ key: 'file:2' })).toBeDefined()
    expect(await ui.find({ key: 'file:3' })).toBeUndefined()
    await ui.input({ key: 'filter', text: 'docs b', kind: 'change' })
    expect((await ui.find({ key: 'file:0' }))?.text).toContain('docs/plan-b.md')
    expect(await ui.find({ key: 'file:1' })).toBeUndefined()
    await ui.input({ key: 'filter', text: 'docs b' })
    expect(await ui.find({ key: 'files' })).toBeDefined()
    await ui.unmount()
  })
}
