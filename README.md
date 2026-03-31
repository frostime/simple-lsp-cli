# simple-lsp-cli

[中文文档](./README_zh-CN.md)

A **lightweight** CLI tool for invoking [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) methods. Designed for AI Agent tool calls.

## Features

- **Agent-friendly**: All output is structured JSON, easy to parse
- **Minimal dependencies**: Only `cross-spawn` + `vscode-jsonrpc`, requires Node.js ≥ 18
- **Cross-platform**: Full support for Windows / macOS / Linux
- **Auto-detection**: Automatically selects the language server based on file extension
- **Daemon mode**: Background persistent process, avoids repeated initialization, greatly speeds up consecutive calls
- **Full LSP coverage**: hover / definition / references / completion / diagnostics / symbols / rename / format / code-actions / signature-help / type-definition
- **Built-in support**: Python (Pyright), TypeScript/JavaScript (typescript-language-server)

## Prerequisites

> `simple-lsp-cli` does **not** bundle any language server.
> After installing this CLI, you still need to install at least one LSP server for your target language.

```bash
# Python (Pyright recommended)
npm install -g pyright

# TypeScript / JavaScript
npm install -g typescript typescript-language-server

# Or pylsp for Python
pip install python-lsp-server
```

## Installation

### As an npm package

```bash
npm install -g simple-lsp-cli
```

Once installed, use either alias:

```bash
slsp --help
simple-lsp-cli --help
```

### Local development

```bash
cd simple-lsp-cli
npm install
npm run build
npm link
```

## Quick Start

```bash
slsp hover -f src/main.py -l 10 -c 5           # Type info + docs
slsp definition -f src/app.ts -l 42 -c 12       # Go to definition
slsp diagnostics -f src/main.py                  # Errors / warnings
slsp symbols -f src/utils.ts                     # Document symbols
slsp references -f src/main.py -l 15 -c 8        # Find references
slsp completion -f src/main.py -l 10 -c 5        # Completion suggestions
slsp rename -f src/main.py -l 5 -c 8 -n newFunc  # Rename symbol
```

## Commands

All positional arguments are **1-based**.

### Position-based (require `--file --line --col`)

| Command | Description |
|---------|-------------|
| `hover` | Type info and documentation |
| `definition` | Go to definition |
| `type-definition` | Go to type definition |
| `references` | Find all references |
| `completion` | Completion suggestions |
| `signature-help` | Function signature info |
| `rename` | Rename symbol (requires `--new-name`) |
| `code-actions` | Code actions |

### File-based (require `--file` only)

| Command | Description |
|---------|-------------|
| `diagnostics` | Errors, warnings, hints |
| `symbols` | Document symbols |
| `format` | Format document |

### Management

| Command | Description |
|---------|-------------|
| `servers` | List language servers |
| `daemon start` | Start background daemon |
| `daemon stop` | Stop daemon |
| `daemon status` | Daemon status |

## Options

```
-f, --file <path>     Target file (required)
-l, --line <n>        Line number (1-based)
-c, --col  <n>        Column number (1-based)
-r, --root <path>     Project root (auto-detected by default)
-s, --server <name>   Force server (pyright|pylsp|typescript)
-n, --new-name <name> New name (for rename)
-w, --wait <ms>       Diagnostics wait time (default 5000)
-v, --verbose         Output LSP logs to stderr
```

## Output Format

```json
{
  "success": true,
  "command": "hover",
  "file": "/abs/path/file.py",
  "position": { "line": 10, "character": 5 },
  "result": { "contents": "(variable) name: str", "range": { "..." : "..." } }
}
```

## Daemon Mode (Auto-managed)

On the first LSP command call, the daemon starts automatically. Subsequent calls reuse the session (~0.7s vs 2-3s cold start). Exits automatically after 15 minutes of inactivity — no manual management needed.

```bash
slsp hover -f src/main.py -l 10 -c 5   # Auto-starts daemon
slsp hover -f src/main.py -l 20 -c 3   # Reuses session, fast response
# Auto-exits after 15 minutes
```

Manual control is still available:

```bash
slsp daemon start     # Start immediately
slsp daemon status    # View status + idle time
slsp daemon stop      # Stop immediately
slsp hover --no-daemon -f ...  # Force inline mode
```

## Agent Integration

```python
import subprocess, json

def lsp(action, file, line=None, col=None, **kw):
    cmd = ["slsp", action, "-f", file]
    if line: cmd += ["-l", str(line)]
    if col:  cmd += ["-c", str(col)]
    for k, v in kw.items():
        cmd += [f"--{k.replace('_', '-')}", str(v)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
```

## Architecture

```
CLI → Daemon(optional) → LspClient → JsonRpcConnection → Language Server (stdio)
```

## License

MIT
