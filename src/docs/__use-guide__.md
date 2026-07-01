---
name: slsp-use-guide
description: Entry-point operating guide for AI agents using slsp. Read this first, then follow the route table to commands/config/slsp-vs-grep as needed.
---

# slsp Use Guide

## What slsp is

`slsp` is a CLI client for Language Server Protocol servers. Treat it as a
bridge from shell commands to LSP methods: you provide files, positions, and
options; `slsp` starts or reuses the right language server and returns compact
text by default, with JSON available when the next step needs exact fields or
edit payloads.

Assume normal LSP semantics: capabilities vary by server, `languageId` matters,
positions target text documents, and diagnostics/cross-reference quality depends
on the underlying server.

## When to use slsp

Use `slsp` when you need semantic code facts from an installed LSP server.
Use `text` for direct reading. Add `--format json` when you want exact fields,
capability matrices, or edit payloads for another tool.

| Need | First command |
|---|---|
| Check whether a file is supported | `slsp servers -f <file> --format json` |
| Inspect file structure | `slsp symbols -f <file>` |
| Read type/docs at a cursor | `slsp hover -f <file> -l <line> -c <col>` |
| Jump to declaration/definition | `slsp definition -f <file> -l <line> -c <col> --format json` |
| Check refactor blast radius | `slsp references -f <file> -l <line> -c <col> --format json` |
| Validate after editing | `slsp diagnostics -f <file>` |

Use `rg`/`grep` first when the file or position is still unknown. See
`slsp-vs-grep` for the combined workflow.

## Required first move

On an unfamiliar file, run capability discovery before semantic calls:

```bash
slsp servers -f <file> --format json
```

Use `result.commands`:

| Support value | Agent action |
|---|---|
| `supported` | Safe to call that slsp command |
| `unsupported` | Use another command or `rg`/`read` |
| `unknown` | Capability is not advertised reliably; `diagnostics` is usually worth trying |

## Operating workflow

```bash
# 0. Discover effective language/server if needed
slsp languages --format json
slsp config --format json

# 1. Inspect selected server and capabilities for the target file
slsp servers -f src/foo.ts --format json

# 2. Orient in the file
slsp symbols -f src/foo.ts

# 3. Ask precise LSP questions
slsp hover      -f src/foo.ts -l 42 -c 10
slsp definition -f src/foo.ts -l 42 -c 10 --format json
slsp references -f src/foo.ts -l 42 -c 10 --format json

# 4. Edit, then validate
slsp diagnostics -f src/foo.ts
```

## Hard rules

1. `--line` and `--col` are **1-based**.
2. Use `text` for direct reading; add `--format json` when a result will be parsed or forwarded to another tool.
3. Run `servers -f <file>` before using semantic commands on unfamiliar files.
4. Run `diagnostics` after every code edit when an LSP server is available.
5. `rename` previews edits and leaves files unchanged.
6. `format` and `code-actions` are server-dependent; check capabilities first.
7. The daemon is auto-managed; use `--no-daemon` only for debugging or isolation.

## Stop conditions

| Symptom | Action |
|---|---|
| `config_error` | Read `slsp-config`; fix config before semantic calls |
| `ENOENT` / `Cannot start` | Language server executable is missing or not on `PATH` |
| `unsupported_capability` | Choose a supported command |
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
