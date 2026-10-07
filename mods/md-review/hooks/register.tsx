import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReviewEditing, ReviewFile, ReviewMode, ReviewPicker } from '../types'
import { anchorFor, blockAt, blockSource, commentIndent, splitBlocks } from './blocks'
import {
  addComment,
  countComments,
  formatComment,
  insertionIndex,
  localDate,
  parseComment,
  replaceComment,
  splitLines,
} from './comments'
import { age, filterFiles, isMarkdown, isSkippedFolder, joinPath, parentOf } from './files'
import type { MarkdownFile } from './files'

const PANE = 'md-review'
const file = atom({ plugin: 'md-review', key: 'file' } as const, null as ReviewFile | null)
const editing = atom({ plugin: 'md-review', key: 'editing' } as const, null as ReviewEditing)
const mode = atom({ plugin: 'md-review', key: 'mode' } as const, 'rendered' as ReviewMode)
const picker = atom({ plugin: 'md-review', key: 'picker' } as const, null as ReviewPicker)

// The Markdown element draws at most this many characters.
const MARKDOWN_LIMIT = 10000
// How often the file is checked for changes made elsewhere (an editor, Claude).
const POLL_MS = 1500
// The picker's limits: how deep and how many entries it searches, how many files it lists.
const SCAN_DEPTH = 12
const SCAN_ENTRIES = 20000
const PICKER_ROWS = 100

function cleanPath(args: string): string {
  return args.trim().replace(/^@/, '').replace(/^["'](.*)["']$/, '$1')
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function leadingSpace(line: string): string {
  return /^\s*/.exec(line)![0]
}

type Scan = { root: string; files: MarkdownFile[]; isTruncated: boolean }

/**
 * The folder the picker searches: the git repository holding the session's
 * project root, or that root itself outside a repository. Not the working
 * directory, which a shell `cd` can leave deep in a subfolder.
 */
async function projectRoot($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  for (let dir: string | undefined = root; dir !== undefined; dir = parentOf(dir)) {
    if (await $.fs.exists(joinPath(dir, '.git')).catch(() => false)) return dir
  }
  return root
}

/** The project's markdown files, relative to its root, skipping hidden and build folders. */
async function scanMarkdown($: EngineInterface): Promise<Scan> {
  const root = await projectRoot($)
  const files: MarkdownFile[] = []
  let visited = 0
  let isTruncated = false
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SCAN_DEPTH || visited > SCAN_ENTRIES) {
      isTruncated = true
      return
    }
    const entries = await $.fs.list(dir === '' ? root : joinPath(root, dir)).catch(() => [])
    for (const entry of entries) {
      visited += 1
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.kind === 'dir' && !isSkippedFolder(entry.name)) await walk(path, depth + 1)
      else if (entry.kind === 'file' && isMarkdown(entry.name)) files.push({ path, mtimeMs: entry.mtimeMs })
    }
  }
  await walk('', 0)
  return { root, files, isTruncated }
}

/** Shows the file picker, filtered by `filter`; `found` saves a second search when the caller already made one. */
async function showPicker(
  $: EngineInterface,
  filter: string,
  found?: Scan,
): Promise<void> {
  const { root, files, isTruncated } = found ?? (await scanMarkdown($))
  await update($, editing, () => null)
  await update($, picker, () => ({ root, files, filter, isTruncated }))
  await $.ui.open({ id: PANE, title: 'Review: pick a file', focus: true })
  await focusOn($, 'filter')
}

/** Opens `path` for review in the pane, leaving the picker. */
async function openFile($: EngineInterface, path: string): Promise<ReviewFile> {
  const loaded = await load($, path)
  await update($, picker, () => null)
  await $.ui.open({ id: PANE, title: `Review: ${baseName(path)}`, focus: true })
  // The pressed file row is gone: keep the focus on something drawn.
  await focusOn($, 'files')
  return loaded
}

async function mtimeOf($: EngineInterface, path: string): Promise<number> {
  return (await $.fs.stat(path)).mtimeMs
}

async function load($: EngineInterface, path: string): Promise<ReviewFile> {
  const text = await $.fs.read(path)
  const loaded: ReviewFile = { path, ...splitLines(text), mtimeMs: await mtimeOf($, path) }
  await update($, file, () => loaded)
  await update($, editing, () => null)
  return loaded
}

/** Reloads the file when it changed on disk, unless the person is typing a comment. */
async function reloadIfChanged($: EngineInterface): Promise<void> {
  const current = await read($, file)
  if (current === null || (await read($, editing)) !== null) return
  const mtimeMs = await mtimeOf($, current.path).catch(() => current.mtimeMs)
  if (mtimeMs !== current.mtimeMs) await load($, current.path)
}

/**
 * Applies `change` to the file as it is on disk now, provided line `line` still
 * holds what the pane showed; otherwise reloads the pane and writes nothing.
 */
async function commit(
  $: EngineInterface,
  shown: ReviewFile,
  line: number,
  change: (lines: readonly string[]) => string[],
): Promise<void> {
  const disk = await load($, shown.path)
  if (disk.lines[line] !== shown.lines[line]) {
    $.ui.toast('The file changed on disk: reloaded it, nothing was written. Try again.')
    return
  }
  const lines = change(disk.lines)
  await $.fs.write(shown.path, lines.join(disk.eol))
  await update($, file, () => ({ ...disk, lines }))
  const mtimeMs = await mtimeOf($, shown.path)
  await update($, file, f => (f === null ? f : { ...f, mtimeMs }))
}

const NO_HANDLE =
  'md-review: set your reviewer handle first, in /config or under pluginConfigs in ~/.claude/settings.json'

function reviewPrompt(path: string, count: number): string {
  return (
    `I've reviewed ${path}. My ${count} review comment(s) are in the file as HTML comments ` +
    `of the form <!-- REVIEW @handle YYYY-MM-DD: ... -->, each placed directly after the line or block it refers to. ` +
    `Address each comment, and remove the ones you've handled. ` +
    `If you disagree with a comment or need more input, leave it in place and tell me.`
  )
}

async function sendToClaude($: EngineInterface): Promise<string> {
  const current = await read($, file)
  if (current === null) return 'No file under review. Use /md-review <path> first.'
  const fresh = await load($, current.path)
  await $.prompt.submit({ text: reviewPrompt(fresh.path, countComments(fresh.lines)), asUser: true })
  return `Asked Claude to address the comments in ${fresh.path}.`
}

/**
 * Moves the pane's focus onto the element `key`. When the pane does not hold
 * the keyboard (a click may not hand it over), asks for it and tries again.
 * Resolves why it could not, or undefined once it did.
 */
async function focusOn($: EngineInterface, key: string): Promise<string | undefined> {
  const attempt = async () =>
    (await $.ui.focus({ requestId: PANE, key }).catch((error: unknown) => ({ deny: String(error) }))).deny
  const denied = await attempt()
  if (denied === undefined) return undefined
  const current = await read($, file)
  await $.ui.open({ id: PANE, title: current ? `Review: ${baseName(current.path)}` : PANE, focus: true })
  return attempt()
}

async function startEditing($: EngineInterface, next: ReviewEditing): Promise<void> {
  await update($, editing, () => next)
  const denied = await focusOn($, 'comment')
  if (denied !== undefined) $.ui.toast(`md-review: could not focus the comment field (${denied})`)
}

/**
 * Closes the input and puts the focus back on the line number it was opened
 * from (or a harmless button when that line is gone), so the focus never sits
 * on an element that no longer exists.
 */
async function stopEditing($: EngineInterface, from: string | undefined): Promise<void> {
  await update($, editing, () => null)
  if (from === undefined || (await focusOn($, from)) !== undefined) await focusOn($, 'reload')
}

export const register: Register = (on, options) => {
  // No default: each person signs their comments with their own handle.
  const handle = typeof options.handle === 'string' && options.handle.trim() !== '' ? options.handle : undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'md-review',
      description: 'Review a markdown file and comment on it; with no argument, pick from the project markdown files',
      argumentHint: '[part of a file name, or a path]',
    })
    await $.command.register({
      name: 'md-review-done',
      description: 'Ask Claude to address the review comments in the file under review',
    })
    $.clock.every(POLL_MS, () => void reloadIfChanged($).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'md-review' }, async ($, e) => {
    const query = cleanPath(e.args)
    try {
      if (query === '') {
        await showPicker($, '')
        return { text: 'Pick a file to review.' }
      }
      const isFile = (path: string) => $.fs.stat(path).then(stat => stat.kind === 'file', () => false)
      // A path is the working directory's, or else the project root's.
      const fromRoot = joinPath(await projectRoot($), query)
      const path = (await isFile(query)) ? query : (await isFile(fromRoot)) ? fromRoot : undefined
      if (path !== undefined) {
        const loaded = await openFile($, path)
        return { text: `Reviewing ${query} (${countComments(loaded.lines)} comment(s) so far).` }
      }
      // Not a file: a part of a name. One match opens; otherwise the picker shows the matches.
      const found = await scanMarkdown($)
      const matching = filterFiles(found.files, query)
      if (matching.length === 1) {
        const loaded = await openFile($, joinPath(found.root, matching[0]!.path))
        return { text: `Reviewing ${matching[0]!.path} (${countComments(loaded.lines)} comment(s) so far).` }
      }
      await showPicker($, query, found)
      return {
        text: matching.length === 0
          ? `No markdown file matches "${query}".`
          : `${matching.length} markdown files match "${query}": pick one.`,
      }
    } catch (error) {
      return { text: `Could not open ${query}: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('command.run', { command: 'md-review-done' }, async $ => ({ text: await sendToClaude($) }))


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The mobile app has no text fields yet: review from the desktop or the terminal.</Text>
    }
    const { Box, Text, Button, Input, Markdown, Code } = $.ui.resolve(e)
    const current = await read($, file)
    const edit = await read($, editing)
    const view = await read($, mode)
    const picking = await read($, picker)

    if (picking !== null) {
      const matching = filterFiles(picking.files, picking.filter)
      const nowMs = await $.clock.now()
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" marginBottom={1}>
            <Input
              key="filter"
              label="find: "
              value={picking.filter}
              placeholder="part of a name or folder; Enter opens the first"
              submitLabel="open"
              autoFocus
              onInput={text => void update($, picker, p => (p === null ? p : { ...p, filter: text }))}
              onSubmit={() => void (matching[0] && openFile($, joinPath(picking.root, matching[0].path)))}
            />
          </Box>
          <Box flexDirection="row" gap={1} marginBottom={1}>
            <Button key="rescan" label="Rescan" onPress={() => showPicker($, picking.filter)} />
            {current !== null && (
              <Button key="back" label={`Back to ${baseName(current.path)}`} onPress={() => openFile($, current.path)} />
            )}
          </Box>
          {matching.length === 0 && <Text dimColor>No markdown file matches.</Text>}
          {matching.slice(0, PICKER_ROWS).map((one, index) => (
            <Box key={`file-row:${index}`} flexDirection="row">
              <Button key={`file:${index}`} label={one.path} plain onPress={() => openFile($, joinPath(picking.root, one.path))} />
              <Text dimColor> · {age(one.mtimeMs, nowMs)}</Text>
            </Box>
          ))}
          {matching.length > PICKER_ROWS && (
            <Text dimColor>…and {matching.length - PICKER_ROWS} more: type to narrow the list.</Text>
          )}
          {picking.isTruncated && <Text dimColor>The project is large: some folders were not searched.</Text>}
        </Box>
      )
    }

    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No file under review.</Text>
          <Button key="files" label="Pick a file" onPress={() => showPicker($, '')} />
        </Box>
      )
    }

    const { lines } = current
    // A trailing newline leaves an empty last element: not a line of its own.
    const shown = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    const blocks = splitBlocks(lines.slice(0, shown))
    const width = String(shown).length
    const numberOf = (i: number) => String(i + 1).padStart(width)
    // While a comment field is open, the line number it was opened from is drawn
    // as a new element: the desktop then hands the focus to the field instead
    // of keeping it on the button (and giving the keys back to the prompt).
    const gutterKey = (i: number) => (edit?.from === `ln:${i}` ? `ln:${i}:open` : `ln:${i}`)
    const newAfter = edit?.kind === 'new' ? insertionIndex(lines, edit.line) - 1 : -1
    const close = () => stopEditing($, edit?.from)
    const now = async () => localDate(await $.clock.now())

    const startNew = (line: number, from: number) =>
      handle === undefined
        ? $.ui.toast(NO_HANDLE)
        : startEditing($, { kind: 'new', line: anchorFor(blocks, line), from: `ln:${from}` })
    const startEdit = (line: number) =>
      handle === undefined ? $.ui.toast(NO_HANDLE) : startEditing($, { kind: 'edit', line, from: `ln:${line}` })

    const commentInput = (value: string, onSubmit: (text: string) => Promise<void>, label: string) => (
      <Box key="comment-row" flexDirection="row" marginLeft={width + 1}>
        <Input
          key="comment"
          label={label}
          value={value}
          placeholder={edit?.kind === 'edit' ? 'empty deletes the comment' : 'your comment'}
          submitLabel="save"
          autoFocus
          onSubmit={text => void onSubmit(text)}
        />
        <Text> </Text>
        <Button key="cancel" label="cancel" dimColor onPress={close} />
      </Box>
    )

    const newCommentInput = (anchor: number) => {
      const block = blockAt(blocks, anchor)
      return commentInput('', async text => {
        if (text.trim() === '') return void (await close())
        const comment = commentIndent(block, lines) + formatComment(handle!, await now(), text)
        await commit($, current, anchor, ls => addComment(ls, anchor, comment))
        await close()
      }, 'comment: ')
    }

    const editCommentInput = (i: number) =>
      commentInput(parseComment(lines[i]!)!.text, async typed => {
        const replacement =
          typed.trim() === '' ? undefined : leadingSpace(lines[i]!) + formatComment(handle!, await now(), typed)
        await commit($, current, i, ls => replaceComment(ls, i, replacement))
        await close()
      }, 'edit: ')

    const commentRow = (i: number) => {
      const comment = parseComment(lines[i]!)!
      return (
        <Box key={`row:${i}`} flexDirection="row">
          <Button key={gutterKey(i)} label={numberOf(i)} plain dimColor onPress={() => startEdit(i)} />
          <Box flexGrow={1} flexShrink={1} marginLeft={1}>
            <Text color="yellow" wrap="wrap">
              {comment.author} {comment.date}: {comment.text}
            </Text>
          </Box>
        </Box>
      )
    }

    const rows = []

    if (view === 'source') {
      for (let i = 0; i < shown; i++) {
        const line = lines[i]!

        if (edit?.kind === 'edit' && edit.line === i && parseComment(line)) {
          rows.push(editCommentInput(i))
        } else if (parseComment(line)) {
          rows.push(commentRow(i))
        } else {
          rows.push(
            <Box key={`row:${i}`} flexDirection="row">
              <Button key={gutterKey(i)} label={numberOf(i)} plain dimColor onPress={() => startNew(i, i)} />
              <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                <Text bold={line.startsWith('#')} wrap="wrap">
                  {line === '' ? ' ' : line}
                </Text>
              </Box>
            </Box>,
          )
        }

        if (i === newAfter && edit) rows.push(newCommentInput(edit.line))
      }
    } else {
      for (const block of blocks) {
        const i = block.start

        if (block.kind === 'comment') {
          rows.push(edit?.kind === 'edit' && edit.line === i ? editCommentInput(i) : commentRow(i))
        } else {
          const source = blockSource(block, lines)
          const body =
            block.kind === 'frontmatter' ? (
              <Code source={source} language="yaml" />
            ) : block.kind === 'html' ? (
              <Text dimColor wrap="wrap">{source}</Text>
            ) : (
              <Markdown text={source.slice(0, MARKDOWN_LIMIT)} />
            )
          rows.push(
            <Box key={`row:${i}`} flexDirection="row" marginTop={block.kind === 'heading' ? 1 : 0}>
              <Button key={gutterKey(i)} label={numberOf(i)} plain dimColor onPress={() => startNew(block.end, i)} />
              <Box flexGrow={1} flexShrink={1} flexDirection="column" marginLeft={1 + block.indent}>
                {body}
              </Box>
            </Box>,
          )
        }

        if (block.end === newAfter && edit) rows.push(newCommentInput(edit.line))
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text dimColor wrap="truncate-start">
            {current.path} · {countComments(lines)} comment(s) · click a line number to comment, or a comment's to edit it{' '}
          </Text>
        </Box>
        {handle === undefined && (
          <Box marginBottom={1}>
            <Text color="yellow" wrap="wrap">
              Set your reviewer handle to comment: in /config, or under pluginConfigs in ~/.claude/settings.json.
            </Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1} marginBottom={1}>
          <Button key="done" label="Send to Claude" variant="primary" onPress={() => void sendToClaude($).then(t => $.ui.toast(t))} />
          <Button
            key="mode"
            label={view === 'source' ? 'Rendered view' : 'Source view'}
            onPress={async () => {
              await update($, editing, () => null)
              await update($, mode, m => (m === 'source' ? 'rendered' : 'source'))
            }}
          />
          <Button key="files" label="Files" onPress={() => showPicker($, '')} />
          <Button key="reload" label="Reload" onPress={() => void load($, current.path)} />
        </Box>
        {rows}
      </Box>
    )
  })
}
