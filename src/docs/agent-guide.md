---
name: slsp-agent-guide
description: Entry-point guide for AI agents using simple-lsp-cli (slsp). Read this first, then read slsp-commands for per-command details.
---

# Using slsp as an AI Agent

`slsp` exposes Language Server Protocol operations as a CLI. Use it to
understand code precisely (types, definitions, references, diagnostics)
instead of guessing from raw text.

Supported files: Python (`.py`, `.pyi`), TypeScript/JavaScript
(`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`).

## Prerequisites (user machine)

At least one LSP server must be installed:

```bash
npm install -g pyright                                 # Python
npm install -g typescript typescript-language-server   # TS/JS
pip install python-lsp-server                          # optional Python alternative
```

If a command fails with `ENOENT` / `Cannot start "..."`, the corresponding
server is missing.

## When to use which command

| Goal | Command |
|---|---|
| Confirm a symbol's type / docs | `hover` |
| Jump to where something is defined | `definition` / `type-definition` |
| Find every usage before editing | `references` |
| Check the file still compiles after an edit | `diagnostics` |
| Get oriented in an unfamiliar file | `symbols` |
| Suggest completions / inspect an API | `completion` |
| Inspect a call's signature | `signature-help` |
| Preview the effect of renaming a symbol | `rename` |
| Discover quick-fixes | `code-actions` |

For guidance on when to reach for `slsp` vs `grep`/`rg`, read `slsp-vs-grep`
(same directory).

## Rules that actually matter

1. `--line` and `--col` are **1-based** (matches what editors show).
2. Default output is compact text; pass `--format json` when you need to parse.
3. **Always re-run `diagnostics` after every code edit.** This is the primary
   feedback loop.
4. The daemon auto-starts on first call and auto-stops after 15 min idle — do
   not manage it unless you have a reason. Use `--no-daemon` only to debug.
5. `rename` only *previews* edits; it does not modify files. Apply the returned
   edits yourself.
6. `format` and `code-actions` depend on the language server. Pyright for
   example does not implement `format`.

## Typical workflow

```
# 1. Orient in a file
slsp symbols -f src/foo.ts

# 2. Inspect the symbol you care about
slsp hover      -f src/foo.ts -l 42 -c 10
slsp definition -f src/foo.ts -l 42 -c 10

# 3. Before changing, check the blast radius
slsp references -f src/foo.ts -l 42 -c 10

# 4. Edit the file, then verify
slsp diagnostics -f src/foo.ts
```

## Output shape (JSON mode)

```
{ "success": true,  "command": "...", "file": "...", "position": {...}, "result": ... }
{ "success": false, "command": "...", "error": "..." }
```

Always check `success` first. Paths in `result` are absolute; ranges are
1-based.

## Next

- `slsp-commands` — per-command flags, result shapes, failure modes.
- `slsp-vs-grep` — when to use slsp vs grep/rg, and how to combine them.
