# Scratchpad

A local-first markdown scratch pad for quick capture. It's a place to collect the strings you need somewhere else: tokens, URLs, commands, IDs, half-formed notes. There's no account and no server: your notes live in `localStorage`.

**Live app:** https://matt-wiley.github.io/cld-scratch-notes/

A sibling of [Linkshelf](https://matt-wiley.github.io/cld-links-manager/), in the same design.

## What it does

- **Notes in markdown**, written in a monospace editor with three views: **Write**, **Split** (side-by-side preview) and **Read**. <kbd>⌘E</kbd> toggles between Write and Read.
- **Notes save as you type.** The note list is sorted by last edit, and pinned notes sit at the top.
- **Search** across all notes (<kbd>/</kbd>). Every word must match, and the list shows the matching line.
- **Light, dark, or match-system theme.** Changes sync live across open tabs.

## Getting strings in

| How | What happens |
| --- | --- |
| Type | Lists continue on <kbd>Enter</kbd> (including `- [ ]` tasks and numbering). <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> indent and outdent. <kbd>⌘B</kbd>, <kbd>⌘I</kbd> and <kbd>⌘K</kbd> wrap the selection. |
| Paste anywhere | <kbd>⌘V</kbd> with the editor unfocused appends the clipboard to the current note on a new line, with an Undo toast. |
| New note | <kbd>n</kbd>, <kbd>⌥N</kbd> or the + button. |
| Drop files | Drop `.md` / `.txt` files to make each one a note, or a `.json` backup to merge it. |

## Getting strings out

In **Read** (or the preview side of **Split**):

- Click any `inline code` to copy just that value.
- Hover any line, list item or code block and click its copy button. This copies the text as shown, without markdown syntax. <kbd>⇧</kbd>-click copies the markdown source instead.
- Paragraphs are line-oriented. Each line is its own copy target, and a single newline is kept as a line break.
- The toolbar copies the whole note or downloads it as `.md`.
- Task checkboxes are clickable and update the source.

## Staying ephemeral

- **Empty notes clean themselves up.** A blank note disappears when you move to another one.
- **The trash** keeps deleted notes for 7 days, then they're gone for good. Deleting also gives an Undo toast.
- **Auto-clear** (Data & settings, off by default) moves unpinned notes to the trash after 1, 7 or 30 days without edits. The top bar shows when the current note will clear.
- **Pin** anything you want to keep around. Pinned notes are never auto-cleared.

Back up now and then (Data & settings → *Full backup*): clearing your browser's site data erases `localStorage`.

## Linking to a note

Each note has its own address (`…/cld-scratch-notes/#<id>`), so a bookmark or a second tab can open a specific note. Links only open your own data: someone else opening the link sees their own Scratchpad.

## Credits

Designed, built and deployed by Claude ([Claude Code](https://claude.com/claude-code)), from goals and requirements set by the repo owner.

## Development

There's no build step and no dependencies. It's plain ES modules.

```bash
npm start   # serves on http://localhost:8080
npm test    # unit tests for the data layer and markdown renderer (node --test)
```

- `js/store.js`: the data model (notes, trash, auto-clear, import and export). It's pure and DOM-free.
- `js/md.js`: a small markdown renderer that escapes everything and marks each line, item and code block as copyable. It's pure and DOM-free.
- `js/app.js`: rendering, the editor, copy, paste capture, shortcuts and cross-tab sync.
- `.github/workflows/pages.yml`: runs the tests, then deploys to GitHub Pages on every push to `main`.
