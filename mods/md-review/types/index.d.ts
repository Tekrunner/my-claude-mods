/** The file under review as last read; `mtimeMs` tells a change on disk. */
export type ReviewFile = { path: string; lines: string[]; eol: string; mtimeMs: number }

/**
 * What the pane's input is doing: a new comment after line `line`, or an
 * existing comment being edited; `from` is the key of the line number pressed,
 * where the focus goes back when the input closes.
 */
export type ReviewEditing = { kind: 'new' | 'edit'; line: number; from: string } | null

export type ReviewMode = 'rendered' | 'source'

/** The file picker while it is shown: the project's root, its markdown files (relative to it) and the filter typed. */
export type ReviewPicker = { root: string; files: { path: string; mtimeMs: number }[]; filter: string; isTruncated: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    'md-review': { file: ReviewFile | null; editing: ReviewEditing; mode: ReviewMode; picker: ReviewPicker }
  }
}
