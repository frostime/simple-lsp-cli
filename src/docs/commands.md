---
name: slsp-commands
description: Per-command reference for slsp — flags, JSON result shapes, failure modes. Read after slsp-use-guide.
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

## Output format guidance

`text` is the default and fits direct reading. `json` is most useful when the
next step needs exact fields, capability matrices, or edit payloads.

| Command | Text fits | JSON fits |
|---|---|---|
| `servers` | quick registry scan | exact config objects |
| `servers -f <file>` | readable support summary | capability matrix for downstream logic |
| `languages`, `config` | short summary | exact config graph and counts |
| `hover`, `symbols`, `diagnostics` | read the result directly | keep raw structure |
| `definition`, `type-definition`, `references` | see locations directly | extract `file` and `range` for another tool |
| `completion`, `signature-help` | scan the active result | keep full item or signature data |
| `format`, `rename`, `code-actions` | preview the edit plan | carry edits forward without loss |

## Capability discovery

### `servers` — list configured servers

```bash
slsp servers
```

Lists the effective server registry: built-in servers plus global and project
`slsp.config.json` entries. Use `--format json` when you want the registry as
an object array.

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
slsp languages
```

Returns language keys, file extensions, LSP `languageId`, candidate servers,
and the default server. Add `--format json` when you want to inspect the full
language map programmatically.

### `config` — show loaded config layers

```bash
slsp config
```

Reports effective `schemaVersion`, loaded global/project config paths, and
language/server counts. Add `--format json` when you want exact paths and
counts for tooling.

## Position-based commands

### `hover` — type and docs at cursor
```
slsp hover -f src/main.py -l 10 -c 5
```
`result.contents` is markdown/plain text. `null` / empty means the server has
nothing to say about that position. Use `--format json` when you want the raw
`range` together with the markdown.

### `definition` / `type-definition` — jump to definition
```
slsp definition -f src/app.ts -l 42 -c 12
```
Returns one `{ file, range }` or an array (multiple definitions possible).
Text shows the locations directly; `--format json` keeps the structure for
follow-up commands.

### `references` — find all usages (includes declaration)
```
slsp references -f src/main.py -l 15 -c 8
```
Array of `{ file, range }`. Empty array = no usages found.

`references` is semantically accurate — it distinguishes symbols with the same
name in different scopes. Prefer it over `grep` when checking blast radius
before a rename or delete. See `slsp-vs-grep` for a detailed comparison.
`--format json` is useful when the locations feed another tool.

### `completion` — completion suggestions
```
slsp completion -f src/main.py -l 10 -c 5
```
Returns `{ isIncomplete, items: [{ label, kind, detail?, documentation? }] }`.
`isIncomplete: true` means the list was truncated — narrow the prefix if
needed. Text is compact for scanning suggestions; `--format json` keeps the
full item metadata.

### `signature-help` — signature at a call site
```
slsp signature-help -f src/main.py -l 10 -c 20
```
Use inside the parentheses of a function call. Text surfaces the active
signature directly; `--format json` keeps every signature and parameter.

### `rename` — preview rename edits
```
slsp rename -f src/main.py -l 5 -c 8 --new-name newFunc
```
Returns `{ edits: [{ file, range, newText }] }`. Files stay unchanged, and
the text preview stays compact for review. Use `--format json` when the edits
will be applied programmatically.

### `code-actions` — quick fixes / refactors at a position
```
slsp code-actions -f src/main.py -l 10 -c 5
```
Optional `--end-line` / `--end-col` to pass a range instead of a point.
Availability is entirely server-dependent. Text gives you the action titles at a
glance; `--format json` keeps the edit payloads.

## File-based commands

### `diagnostics` — errors, warnings, hints
```
slsp diagnostics -f src/main.py
```
Empty array = clean file. Each entry:
`{ severity, message, range, source?, code? }`, with
`severity` ∈ `error | warning | info | hint`.

Run this after every code edit as the primary feedback loop. It catches type
and semantic errors that text search cannot surface. Text is a readable error
summary; `--format json` keeps exact fields for scripting.

Use `-w, --wait <ms>` to extend how long to wait for the first diagnostics
batch (default 5000 ms). Slow servers may need more.

### `symbols` — hierarchical document symbols
```
slsp symbols -f src/app.ts
```
Tree of `{ name, kind, range, selectionRange, children? }`. Good first call
on an unfamiliar file — gives a structured map of functions, classes, and
their nested locals without reading the file line by line. Text shows the tree
compactly; `--format json` keeps the full symbol structure.

### `format` — formatting edits
```
slsp format -f src/main.py
```
Returns `{ edits: [...] }`. Some servers do not implement formatting. Check
`slsp servers -f <file> --format json` first. Use `--format json` when you want
to apply the returned edits; the text preview stays concise for review.

## Related docs

| Need | Read |
|---|---|
| Operating workflow | `slsp-use-guide` |
| Configure languages and servers | `slsp-config` |
| Choose between LSP and text search | `slsp-vs-grep` |

## Failure shape

```json
{ "success": false, "command": "<cmd>", "file": "...", "error": { "code": "...", "message": "..." } }
```

Common errors:

- `config_error` — invalid `slsp.config.json`; fix config before retrying.
- `unsupported_capability` — selected server does not support the command;
  `slsp servers -f <file> --format json` shows the supported command set.
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
