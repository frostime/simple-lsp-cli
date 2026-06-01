---
name: slsp-commands
description: Per-command reference for slsp — flags, JSON result shapes, failure modes. Read after slsp-agent-guide.
---

# slsp Command Reference

Invocation: `slsp <command> [options]`

Shared flags:

- `-f, --file <path>` — target file
- `-l, --line <n>` / `-c, --col <n>` — cursor position, **1-based**
- `-r, --root <path>` — override project root (default: auto-detect)
- `-s, --server <name>` — force backend server id
- `--format text|json` — output format (default `text`)
- `--no-daemon` — bypass daemon, run inline
- `-v, --verbose` — forward LSP stderr for debugging
- `-h, --help` — show help; use with a command name for command-specific help
- `-V, --version` — print version and exit

## Capability discovery

### `servers` — list configured servers

```bash
slsp servers --format json
```

Lists the effective server registry: built-in servers plus global and project
`slsp.config.json` entries.

### `servers -f <file>` — inspect selected server and capabilities

```bash
slsp servers -f src/main.py --format json
```

Starts the selected language server, reads its initialize capabilities, and
returns a command support matrix.

```json
{
  "success": true,
  "command": "servers",
  "file": "/project/src/main.py",
  "result": {
    "selected": {
      "id": "pyright",
      "name": "Pyright",
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "root": "/project",
      "languageId": "python",
      "configPaths": {}
    },
    "commands": {
      "hover": "supported",
      "definition": "supported",
      "typeDefinition": "supported",
      "references": "supported",
      "completion": "supported",
      "signatureHelp": "supported",
      "symbols": "supported",
      "format": "unsupported",
      "diagnostics": "unknown",
      "rename": "supported",
      "codeActions": "supported"
    }
  }
}
```

Agents should use this before semantic calls on unfamiliar files.

### `languages` — list configured languages

```bash
slsp languages --format json
```

Returns language keys, file extensions, LSP `languageId`, candidate servers,
and the default server. Use this to discover supported languages without
starting an LSP process.

### `config` — show loaded config layers

```bash
slsp config --format json
```

Reports effective `schemaVersion`, loaded global/project config paths, and
language/server counts.

## Position-based commands

### `hover` — type and docs at cursor
```
slsp hover -f src/main.py -l 10 -c 5
```
`result.contents` is markdown/plain text. `null` / empty means the server has
nothing to say about that position.

### `definition` / `type-definition` — jump to definition
```
slsp definition -f src/app.ts -l 42 -c 12
```
Returns one `{ file, range }` or an array (multiple definitions possible).

### `references` — find all usages (includes declaration)
```
slsp references -f src/main.py -l 15 -c 8
```
Array of `{ file, range }`. Empty array = no usages found.

`references` is semantically accurate — it distinguishes symbols with the same
name in different scopes. Prefer it over `grep` when checking blast radius
before a rename or delete. See `slsp-vs-grep` for a detailed comparison.

### `completion` — completion suggestions
```
slsp completion -f src/main.py -l 10 -c 5
```
Returns `{ isIncomplete, items: [{ label, kind, detail?, documentation? }] }`.
`isIncomplete: true` means the list was truncated — narrow the prefix if
needed.

### `signature-help` — signature at a call site
```
slsp signature-help -f src/main.py -l 10 -c 20
```
Use inside the parentheses of a function call.

### `rename` — preview rename edits
```
slsp rename -f src/main.py -l 5 -c 8 --new-name newFunc
```
Returns `{ edits: [{ file, range, newText }] }`. **Files are not modified** —
apply edits yourself after inspecting them.

### `code-actions` — quick fixes / refactors at a position
```
slsp code-actions -f src/main.py -l 10 -c 5
```
Optional `--end-line` / `--end-col` to pass a range instead of a point.
Availability is entirely server-dependent.

## File-based commands

### `diagnostics` — errors, warnings, hints
```
slsp diagnostics -f src/main.py
```
Empty array = clean file. Each entry:
`{ severity, message, range, source?, code? }`, with
`severity` ∈ `error | warning | info | hint`.

Run this after every code edit as the primary feedback loop. It catches type
and semantic errors that text search cannot surface.

Use `-w, --wait <ms>` to extend how long to wait for the first diagnostics
batch (default 5000 ms). Slow servers may need more.

### `symbols` — hierarchical document symbols
```
slsp symbols -f src/app.ts
```
Tree of `{ name, kind, range, selectionRange, children? }`. Good first call
on an unfamiliar file — gives a structured map of functions, classes, and
their nested locals without reading the file line by line.

### `format` — formatting edits
```
slsp format -f src/main.py
```
Returns `{ edits: [...] }`. Some servers do not implement formatting. Check
`slsp servers -f <file> --format json` first.

## Config

Config layers are merged in order:

```text
built-in < ~/.config/simple-lsp-cli/slsp.config.json < project slsp.config.json
```

Current config is language-first:

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

Rules:

- `schemaVersion` should be `"2.0"`; `"1.0"` configs are migrated in memory.
- `languages` owns extension recognition and LSP `languageId`.
- `languages.*.servers` is ordered; the first server is default.
- `servers` owns process launch options only.
- User `languages[id]` / `servers[id]` replace built-in entries with the same id.
- Bad config returns `config_error`; no silent fallback.

## Failure shape

```json
{ "success": false, "command": "<cmd>", "file": "...", "error": { "code": "...", "message": "..." } }
```

Common errors:

- `config_error` — invalid `slsp.config.json`; fix config before retrying.
- `unsupported_capability` — selected server does not support the command; use
  `slsp servers -f <file> --format json` and choose a supported command.
- `ENOENT` / `Cannot start "..."` — language server binary missing.
- `timed out` — server hung. Retry; use `-v` to see its stderr.
- `No server for .xxx files` — file extension is not supported by built-in or
  configured servers.
- `File not found: <path>` — check the path; `slsp` requires it to exist.
- `Missing required option: --<flag>` — position-based commands need both
  `--line` and `--col`.
- `unknown_option` — unrecognized flag; check spelling.

## Daemon cheatsheet

```
slsp daemon status          # inspect, shows idle time
slsp daemon start           # start explicitly (optional; auto-started anyway)
slsp daemon stop            # stop explicitly (also auto-stops at 15 min idle)
slsp <cmd> --no-daemon ...  # one-shot, bypass the daemon entirely
```
