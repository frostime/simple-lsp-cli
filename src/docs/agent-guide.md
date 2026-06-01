---
name: slsp-agent-guide
description: Entry-point guide for AI agents using simple-lsp-cli (slsp). Read this first, then read slsp-commands for per-command details.
---

# Using slsp as an AI Agent

`slsp` exposes Language Server Protocol operations as a CLI. Use it to
understand code precisely (types, definitions, references, diagnostics)
instead of guessing from raw text.

Built-in files: Python (`.py`, `.pyi`), TypeScript/JavaScript
(`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`), and Rust (`.rs`). Users and
projects can add more languages with `slsp.config.json`.

## Prerequisites (user machine)

At least one LSP server must be installed:

```bash
npm install -g pyright                                 # Python
npm install -g typescript typescript-language-server   # TS/JS
pip install python-lsp-server                          # optional Python alternative
rustup component add rust-analyzer                     # Rust
```

If a command fails with `ENOENT` / `Cannot start "..."`, the corresponding
server is missing.

## Agent-first rule: inspect capabilities first

On an unfamiliar project/file, run:

```bash
slsp servers -f <file> --format json
```

Use `result.commands` to decide which semantic commands are safe to call. If a
command is `unsupported`, do not retry blindly. Use another supported `slsp`
command, `rg`, or `read`.

```json
{
  "success": true,
  "command": "servers",
  "file": "/project/src/main.py",
  "result": {
    "selected": {
      "id": "pyright",
      "name": "Pyright",
      "root": "/project",
      "languageId": "python",
      "configPaths": {}
    },
    "commands": {
      "hover": "supported",
      "definition": "supported",
      "format": "unsupported",
      "diagnostics": "unknown"
    }
  }
}
```

`unknown` means LSP capabilities cannot reliably advertise that feature. It is
usually safe to try `diagnostics`.

## When to use which command

| Goal | Command |
|---|---|
| Inspect configured languages | `languages` |
| Inspect loaded config layers | `config` |
| Inspect available backend and capabilities | `servers -f <file>` |
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
2. Use `--format json` for Agent decisions.
3. First call on an unfamiliar file: `slsp servers -f <file> --format json`.
4. **Always re-run `diagnostics` after every code edit.** This is the primary
   feedback loop.
5. The daemon auto-starts on first call and auto-stops after 15 min idle — do
   not manage it unless you have a reason. Use `--no-daemon` only to debug.
6. `rename` only *previews* edits; it does not modify files. Apply the returned
   edits yourself.
7. `format` and `code-actions` depend on the language server. Check
   `servers -f` before using them.

## Typical workflow

```
# 0. Inspect selected server and supported commands
slsp servers -f src/foo.ts --format json

# 1. Orient in a file
slsp symbols -f src/foo.ts --format json

# 2. Inspect the symbol you care about
slsp hover      -f src/foo.ts -l 42 -c 10 --format json
slsp definition -f src/foo.ts -l 42 -c 10 --format json

# 3. Before changing, check the blast radius
slsp references -f src/foo.ts -l 42 -c 10 --format json

# 4. Edit the file, then verify
slsp diagnostics -f src/foo.ts --format json
```

## Config

Use `slsp.config.json` to add or override languages and language servers.
Global config is loaded from `~/.config/simple-lsp-cli/slsp.config.json` (or
`$XDG_CONFIG_HOME/simple-lsp-cli/slsp.config.json`) before project config.

```json
{
  "$schema": "https://raw.githubusercontent.com/frostime/simple-lsp-cli/main/schema/slsp.schema.json",
  "schemaVersion": "2.0",
  "languages": {
    "latex": {
      "extensions": ["tex", "cls", "sty"],
      "languageId": "latex",
      "servers": ["texlab"]
    },
    "bibtex": {
      "extensions": ["bib"],
      "languageId": "bibtex",
      "servers": ["texlab"]
    }
  },
  "servers": {
    "texlab": {
      "name": "TexLab",
      "command": "texlab",
      "args": [],
      "transport": "stdio",
      "rootMarkers": [".latexmkrc", "Tectonic.toml", ".git"],
      "initializationOptions": {},
      "env": {}
    }
  }
}
```

Config errors are fail-fast. If `slsp.config.json` is invalid, fix it before
calling semantic commands. Run `slsp languages --format json` to inspect the
effective language mapping.

## Output shape (JSON mode)

```
{ "success": true,  "command": "...", "file": "...", "position": {...}, "result": ... }
{ "success": false, "command": "...", "error": { "code": "...", "message": "..." } }
```

Always check `success` first. Paths in `result` are absolute; ranges are
1-based.

## Next

- `slsp-commands` — per-command flags, result shapes, failure modes.
- `slsp-vs-grep` — when to use slsp vs grep/rg, and how to combine them.
