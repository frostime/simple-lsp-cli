---
name: slsp-commands
description: Per-command reference for slsp — flags, JSON result shapes, failure modes. Read after slsp-agent-guide.
---

# slsp Command Reference

Invocation: `slsp <command> [options]`

Shared flags:

- `-f, --file <path>` — target file (required for every command)
- `-l, --line <n>` / `-c, --col <n>` — cursor position, **1-based**
- `-r, --root <path>` — override project root (default: auto-detect)
- `-s, --server <name>` — force backend: `pyright` | `pylsp` | `typescript`
- `--format text|json` — output format (default `text`)
- `--no-daemon` — bypass daemon, run inline
- `-v, --verbose` — forward LSP stderr for debugging

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
batch (default 5000 ms). Slow servers (first-run Pyright) may need more.

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
Returns `{ edits: [...] }`. **Pyright does not implement this** — switch to
`--server pylsp` for Python if you need formatting.

## Failure shape

```
{ "success": false, "command": "<cmd>", "file": "...", "error": "<message>" }
```

Common errors and what they mean:

- `ENOENT` / `Cannot start "..."` — language server binary missing; install
  it (`npm i -g pyright` / `npm i -g typescript typescript-language-server`).
- `timed out` — server hung. Retry; use `-v` to see its stderr.
- `No server for .xxx files` — file extension not supported.
- `File not found: <path>` — check the path; `slsp` requires it to exist.
- `Missing required option: --<flag>` — position-based commands need both
  `--line` and `--col`.

## Daemon cheatsheet

```
slsp daemon status          # inspect, shows idle time
slsp daemon start           # start explicitly (optional; auto-started anyway)
slsp daemon stop            # stop explicitly (also auto-stops at 15 min idle)
slsp <cmd> --no-daemon ...  # one-shot, bypass the daemon entirely
```
