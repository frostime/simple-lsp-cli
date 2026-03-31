# Skill: simple-lsp-cli — Code Intelligence via LSP

## Overview

`simple-lsp-cli` (`slsp`) is a lightweight CLI for invoking Language Server Protocol methods.
It is designed for AI agents and automation tools that need structured code intelligence from the command line.

All command output is structured JSON.
Position arguments are **1-based**.

Supported languages:
- Python (`.py`, `.pyi`)
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)

---

## Prerequisites

Make sure the corresponding language servers are installed before use.

Check availability:

```bash
which pyright-langserver
which typescript-language-server
```

Install if needed:

```bash
npm install -g pyright
npm install -g typescript typescript-language-server
```

Optional Python alternative:

```bash
pip install python-lsp-server
```

---

## Core Commands

### 1. `diagnostics`

Use this after editing a file to retrieve errors, warnings, and hints.

```bash
slsp diagnostics -f <file>
```

Typical output shape:

```json
{
  "success": true,
  "command": "diagnostics",
  "file": "/project/src/main.py",
  "result": [
    {
      "severity": "error",
      "message": "Argument of type \"str\" cannot be assigned to parameter \"count\" of type \"int\"",
      "range": {
        "start": { "line": 15, "character": 10 },
        "end": { "line": 15, "character": 18 }
      },
      "source": "Pyright"
    }
  ]
}
```

Interpretation:
- `result` is an array of diagnostics
- `[]` means no issues were reported
- `severity` is one of `error`, `warning`, `info`, `hint`

### 2. `hover`

Use this to inspect the type or documentation of a symbol.

```bash
slsp hover -f <file> -l <line> -c <col>
```

Important fields:
- `result.contents`: markdown/plaintext description
- `result.range`: symbol range

### 3. `definition`

Use this to find the definition location of a symbol.

```bash
slsp definition -f <file> -l <line> -c <col>
```

Important fields:
- `result.file`: absolute local path
- `result.range`: definition range

Result may be a single object or an array.

### 4. `references`

Use this before renaming or to understand usage sites.

```bash
slsp references -f <file> -l <line> -c <col>
```

Returns a list of locations.

### 5. `symbols`

Use this to inspect the structure of a file quickly.

```bash
slsp symbols -f <file>
```

Useful for large files, navigation, and unfamiliar code.

### 6. `completion`

Use this to retrieve completion suggestions.

```bash
slsp completion -f <file> -l <line> -c <col>
```

### 7. `rename`

Use this to preview a safe rename operation.

```bash
slsp rename -f <file> -l <line> -c <col> --new-name <newName>
```

This returns edit descriptions only. It does **not** modify files automatically.

### 8. `format`

```bash
slsp format -f <file>
```

Returns formatting edits only.

### 9. `signature-help`

```bash
slsp signature-help -f <file> -l <line> -c <col>
```

Useful inside function calls.

### 10. `code-actions`

```bash
slsp code-actions -f <file> -l <line> -c <col>
```

Returns quick fixes, refactors, and other server-provided actions.

---

## Daemon Mode

The daemon starts automatically on the first LSP command and exits after 15 minutes of inactivity.
Repeated calls are much faster because language server sessions are reused.

Typical usage:

```bash
slsp diagnostics -f src/main.py
slsp hover -f src/main.py -l 10 -c 5
slsp definition -f src/main.py -l 10 -c 5
```

Check daemon status:

```bash
slsp daemon status
```

Force one-shot mode:

```bash
slsp hover -f src/main.py -l 10 -c 5 --no-daemon
```

---

## Common Workflows

### Workflow 1: Diagnose and verify

```bash
slsp diagnostics -f src/main.py
slsp hover -f src/main.py -l <line> -c <col>
slsp definition -f src/main.py -l <line> -c <col>
slsp diagnostics -f src/main.py
```

### Workflow 2: Understand unfamiliar code

```bash
slsp symbols -f src/module.py
slsp hover -f src/module.py -l 25 -c 10
slsp definition -f src/module.py -l 25 -c 10
slsp references -f src/module.py -l 25 -c 10
```

### Workflow 3: Safe refactor preview

```bash
slsp references -f src/main.py -l 12 -c 5
slsp rename -f src/main.py -l 12 -c 5 --new-name betterName
slsp diagnostics -f src/main.py
```

---

## Best Practices

1. Prefer direct LSP commands; daemon management is usually unnecessary.
2. Re-run `diagnostics` after making changes.
3. CLI positions are **1-based**.
4. Check the `success` field first.
5. Use `--root` when auto-detection is not correct.
6. Use `--server` to switch Python backends when needed.
7. Use `--no-daemon` when you need a fully isolated session.

---

## Capability Boundaries

Not every language server implements every LSP feature.

Examples:
- `pyright` may not implement `textDocument/formatting`
- some `code-actions` depend on server-specific support
- behavior can vary between `pyright`, `pylsp`, and `typescript-language-server`

Treat `format`, `code-actions`, and similar features as **server-dependent**.

---

## Error Handling

Failure output looks like this:

```json
{
  "success": false,
  "command": "hover",
  "error": "Cannot start \"pyright-langserver\": spawn pyright-langserver ENOENT"
}
```

Common errors:
- `ENOENT`: language server is not installed
- `timed out`: server took too long to respond
- `No server for .xxx files`: unsupported file type

---

## Test Commands

This project includes both unit and integration tests.

Run all tests:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run only integration tests:

```bash
npm run test:integration
```

Integration tests create temporary fixtures under `temp/` to avoid polluting the repository.

---

## Integration Snippets

### Bash

```bash
lsp() {
  local action="$1"; shift
  slsp "$action" "$@" 2>/dev/null
}
```

### Python

```python
import subprocess
import json


def lsp(action: str, file: str, line: int = None, col: int = None, **kw) -> dict:
    cmd = ["slsp", action, "-f", file]
    if line is not None:
        cmd += ["-l", str(line)]
    if col is not None:
        cmd += ["-c", str(col)]
    for k, v in kw.items():
        cmd += [f"--{k.replace('_', '-')}", str(v)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return json.loads(proc.stdout)
```

### Node.js library usage

```ts
import { LspClient, SERVER_REGISTRY, simplify } from "simple-lsp-cli";

const client = new LspClient({
  server: SERVER_REGISTRY.pyright,
  rootPath: "/path/to/project",
});

await client.start();
console.log(simplify(await client.hover("src/main.py", 9, 4))); // library API is 0-based
await client.stop();
```
