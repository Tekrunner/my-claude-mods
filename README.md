# my-claude-mods

Personal Claude Code mods, published as the `yann-mods` plugin marketplace. They have only been tested in the desktop app's Code tab so far.

## Install

Add the marketplace once:

```
/plugin marketplace add Tekrunner/my-claude-mods
```

Then install the mods you want:

```
/plugin install limits-band@yann-mods
/plugin install token-usage@yann-mods
/plugin install md-review@yann-mods
```

## Mods

### limits-band

Shows your usage limits in a band just above the prompt, so you don't have to ask for them:

```
5h ███░░░░░░░░░ 24% resets in 3h 12m (17:45)   Week ██████░░░░░░ 51% resets in 2d 4h (Fri 09:00)
```

- One bar per limit: the 5-hour window, the weekly limit and, if you have one, the spend limit.
- Bars turn yellow at 50% and red at 80%.
- Each bar shows when the limit resets, as a countdown and as a local time.
- The values refresh at session start, whenever a limit moves, and after each turn.

### token-usage

Adds a line under each of Claude's answers with the tokens that turn used:

```
in 1.2k · cache write 3.4k · cache read 45.6k · out 812 · hit 91%
```

- **in:** uncached input tokens.
- **cache write / cache read:** prompt tokens written to and read from the prompt cache.
- **out:** output tokens.
- **hit:** the share of the prompt read from cache. Green from 80%, yellow from 50%, red below.

Only main-conversation turns get a line. Subagent usage is already counted in the parent turn. Only the last 200 answers of a session keep their line: older ones are shown without it.

### md-review

Review a markdown file the way you'd review a pull request: open it in a side pane, click a line to comment on it, then hand the comments to Claude.

**Commands**

- `/md-review <path>` opens that file for review.
- `/md-review <part of a name>` opens the file if exactly one matches, otherwise shows the matches.
- `/md-review` with no argument opens a picker listing the project's markdown files, most recently changed first. Hidden folders and build folders (`node_modules`, `dist`, `build`, ...) are skipped.
- `/md-review-done` asks Claude to address the comments in the file under review. The pane's **Send to Claude** button does the same.

**Commenting**

- Click a line number to add a comment under that line or block. Click a comment's line number to edit it; saving it empty deletes it.
- Comments are written straight into the file as HTML comments, so they don't show when the markdown is rendered. Each one takes its own line, in the form `<!-- REVIEW @handle 2026-10-07: This step needs an example. -->`.

- In the rendered view, comments go after whole blocks (a paragraph, list item, table, code fence, front matter), never inside one. Switch to the source view to comment on single lines.
- The pane reloads the file when it changes on disk, for example when Claude edits it. If the file changed under a line you're commenting on, nothing is written and the pane reloads so you can try again.

When you send the review, Claude is asked to address each comment and remove the ones it handled, and to leave any it disagrees with in place and tell you.

**Settings**

- `handle`: the name written in each comment, without the `@`. It has no default: until you set it, the pane asks for it instead of adding comments.

Set it in `/config` (run from a terminal `claude` session), or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "md-review@yann-mods": { "options": { "handle": "your-handle" } }
}
```

The mobile app has no text fields yet, so the pane can't be used there.
