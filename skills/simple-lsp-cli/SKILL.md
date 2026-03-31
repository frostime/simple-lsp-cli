# Skill: simple-lsp-cli — Code Intelligence via LSP

`slsp` — CLI for invoking LSP methods. Output is structured JSON.

Supported: Python (`.py`, `.pyi`), TypeScript/JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`)

## Prerequisites

```bash
npm install -g pyright                              # Python
npm install -g typescript typescript-language-server # TS/JS
# Optional Python alternative:
pip install python-lsp-server
```

## Global Flags

- `-f <file>` — target file (required for all commands)
- `-l <line> -c <col>` — cursor position, **1-based**
- `--root <dir>` — project root override (default: auto-detect)
- `--server <name>` — switch language server backend (e.g. `pylsp` for Python)
- `--no-daemon` — force one-shot mode, skip daemon

## Commands

### diagnostics

Retrieve errors, warnings, and hints for a file. Run after every edit.

```bash
slsp diagnostics -f <file>
```

- `result`: array of `{ severity, message, range, source }`
- `severity`: `error` | `warning` | `info` | `hint`
- Empty `result` (`[]`) means no issues.

### hover

Inspect type or documentation of a symbol.

```bash
slsp hover -f <file> -l <line> -c <col>
```

- `result.contents`: markdown/plaintext description
- `result.range`: symbol span

### definition

Jump to the definition of a symbol.

```bash
slsp definition -f <file> -l <line> -c <col>
```

- `result.file`: absolute path to definition file
- `result.range`: definition span
- May return a single object or an array (multiple definitions).

### references

Find all usage sites of a symbol. Useful before renaming.

```bash
slsp references -f <file> -l <line> -c <col>
```

- Returns array of `{ file, range }`.

### symbols

List all symbols in a file. Useful for navigating large/unfamiliar files.

```bash
slsp symbols -f <file>
```

### completion

Get completion suggestions at a position.

```bash
slsp completion -f <file> -l <line> -c <col>
```

### rename

Preview a rename operation. Returns edit descriptions only — does **not** modify files.

```bash
slsp rename -f <file> -l <line> -c <col> --new-name <newName>
```

### format

Get formatting edits for a file. Server-dependent (e.g. `pyright` may not support it).

```bash
slsp format -f <file>
```

### signature-help

Get function signature info at cursor. Useful inside function call parentheses.

```bash
slsp signature-help -f <file> -l <line> -c <col>
```

### code-actions

Get available quick fixes and refactors. Server-dependent.

```bash
slsp code-actions -f <file> -l <line> -c <col>
```

## Output Format

Success: `{ "success": true, "command": "<cmd>", "file": "<path>", "result": ... }`

Failure: `{ "success": false, "command": "<cmd>", "error": "<message>" }`

Always check `success` field first.

Common errors:
- `ENOENT` — language server not installed
- `timed out` — server unresponsive
- `No server for .xxx files` — unsupported file type

## Daemon

Daemon auto-starts on first LSP call, auto-exits after 15 min idle. No manual management needed.

Use `slsp daemon status` to check, `--no-daemon` to bypass.

## Key Rules

- Positions are **1-based**.
- Re-run `diagnostics` after code changes.
- `format`, `code-actions` availability depends on the language server implementation.
