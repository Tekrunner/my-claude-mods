// Pure helpers for finding markdown files: matching a typed filter, and ages.

export type MarkdownFile = { path: string; mtimeMs: number }

/** Folders never worth searching for files to review. */
export const SKIPPED_FOLDERS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'venv',
  '__pycache__',
  'site-packages',
])

export function isSkippedFolder(name: string): boolean {
  // Hidden folders (.git, .venv, .idea, ...) included.
  return name.startsWith('.') || SKIPPED_FOLDERS.has(name)
}

export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

/** Whether every word of `filter` appears in the path, ignoring case and slash direction. */
export function matches(path: string, filter: string): boolean {
  const haystack = path.toLowerCase().replace(/\\/g, '/')
  return filter
    .toLowerCase()
    .replace(/\\/g, '/')
    .split(/\s+/)
    .filter(Boolean)
    .every(word => haystack.includes(word))
}

/** The files matching `filter`, most recently modified first. */
export function filterFiles(files: readonly MarkdownFile[], filter: string): MarkdownFile[] {
  return files.filter(file => matches(file.path, filter)).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function age(mtimeMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - mtimeMs) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 60 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}
