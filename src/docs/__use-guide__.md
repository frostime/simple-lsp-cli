---
name: slsp-use-guide
description: Entry-point operating guide for AI agents using slsp. Read this first, then follow the route table to commands/config/slsp-vs-grep as needed.
---

# slsp Use Guide

## What slsp is

`slsp` is a CLI client for Language Server Protocol servers. Treat it as a
bridge from shell commands to LSP methods: you provide files, positions, and
options; `slsp` starts or reuses the right language server and returns compact
text or JSON.

Assume normal LSP semantics: capabilities vary by server, `languageId` matters,
positions target text documents, and diagnostics/cross-reference quality depends
on the underlying server.

## When to use slsp

Use `slsp` when you need semantic code facts from an installed LSP server:

| Need | First command |
|---|---|
| Know whether slsp supports this file | `slsp servers -f <file> --format json` |
| Inspect file structure | `slsp symbols -f <file> --format json` |
| Understand symbol type/docs | `slsp hover -f <file> -l <line> -c <col> --format json` |
| Jump to declaration/definition | `slsp definition -f <file> -l <line> -c <col> --format json` |
| Check refactor blast radius | `slsp references -f <file> -l <line> -c <col> --format json` |
| Validate after editing | `slsp diagnostics -f <file> --format json` |

Use `rg`/`grep` first when you do not yet know the file or position to ask LSP
about. See `slsp-vs-grep` for the combined workflow.

## Required first move

On an unfamiliar file, run capability discovery before semantic calls:

```bash
slsp servers -f <file> --format json
```

Use `result.commands`:

| Support value | Agent action |
|---|---|
| `supported` | Safe to call that slsp command |
| `unsupported` | Do not retry blindly; use another command or `rg`/`read` |
| `unknown` | Capability cannot be advertised reliably; `diagnostics` is usually worth trying |

## Operating workflow

```bash
# 0. Discover effective language/server if needed
slsp languages --format json
slsp config --format json

# 1. Inspect selected server and capabilities for the target file
slsp servers -f src/foo.ts --format json

# 2. Orient in the file
slsp symbols -f src/foo.ts --format json

# 3. Ask precise LSP questions
slsp hover      -f src/foo.ts -l 42 -c 10 --format json
slsp definition -f src/foo.ts -l 42 -c 10 --format json
slsp references -f src/foo.ts -l 42 -c 10 --format json

# 4. Edit, then validate
slsp diagnostics -f src/foo.ts --format json
```

## Hard rules

1. `--line` and `--col` are **1-based**.
2. Use `--format json` for Agent decisions.
3. Run `servers -f <file>` before using semantic commands on unfamiliar files.
4. Run `diagnostics` after every code edit when an LSP server is available.
5. `rename` previews edits; it does not modify files.
6. `format` and `code-actions` are server-dependent; check capabilities first.
7. The daemon is auto-managed; use `--no-daemon` only for debugging or isolation.

## Stop conditions

| Symptom | Action |
|---|---|
| `config_error` | Read `slsp-config`; fix config before semantic calls |
| `ENOENT` / `Cannot start` | Language server executable is missing or not on `PATH` |
| `unsupported_capability` | Choose a supported command; do not repeat the same call |
| `No server for .xxx files` | Read `slsp-config`; add a language/server mapping |
| Wrong or surprising result | Verify root/config with `servers -f`; fall back to `rg` when LSP resolution is weak |

## Route to deeper docs

| Task | Read |
|---|---|
| Need exact flags, JSON shapes, failure modes | `slsp-commands` |
| Add or debug language/server config | `slsp-config` |
| Decide when to use LSP vs text search | `slsp-vs-grep` |

## Built-in language mappings

Built-in mappings cover Python, TypeScript/JavaScript, and Rust. `slsp` does
not bundle language servers; the corresponding server binary must be installed
separately.
