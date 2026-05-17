---
name: slsp-vs-grep
description: When to use slsp vs grep/rg — tool choice, strengths, and a recommended combined workflow for AI agents.
---

# slsp vs grep/rg

`grep` / `rg` and `slsp` solve different problems. Use both.

## Division of responsibility

| Tool | Strength | Typical trigger |
|---|---|---|
| `rg` / `grep` | Wide text search across files | "find all files that mention X" |
| `slsp symbols` | File structure map | "what functions/classes are in this file?" |
| `slsp references` | Semantic usage lookup | "where is this specific symbol used?" |
| `slsp definition` | Jump-to-definition | "where is this symbol defined?" |
| `slsp hover` | Type and doc inspection | "what type is this expression?" |
| `slsp diagnostics` | Post-edit validation | "did my edit break anything?" |

## Why grep alone is not enough

`rg "callEndpoint" src` returns all text matches:

```
src/commands/api.ts:64:async function callEndpoint(       ← local function definition
src/commands/api.ts:184:            await callEndpoint(   ← call site
src/core/schema.ts:194:    callEndpoint: <T = unknown>    ← type field
src/core/tools.ts:52:    const callEndpoint: ToolContext  ← different local variable
src/tools/append-content.ts:86: ctx.callEndpoint<...>    ← method call on ctx
src/docs/extending/20-tool-schema.md:109:callEndpoint     ← doc text
```

These are at least four distinct things: a local function, a type field, a
different local variable, and a method call. grep cannot distinguish them.

`slsp references` on the local function at line 64:

```bash
slsp references -f src/commands/api.ts -l 64 -c 17 --format json
```

Returns exactly the two locations that refer to *that* function:

```json
[
  { "file": "src/commands/api.ts", "range": { "start": { "line": 64, "character": 16 } } },
  { "file": "src/commands/api.ts", "range": { "start": { "line": 184, "character": 19 } } }
]
```

## Why slsp alone is not enough

`slsp` needs a file path and a cursor position. You have to know *where* to
point it before it can help. `rg` is the right tool for that initial discovery.

`slsp` also has no view into Markdown, JSON, YAML, or any file type not
supported by an LSP server. Use `rg` for those.

Language servers differ. Before using semantic commands on an unfamiliar file,
run `slsp servers -f <file> --format json`. If `result.commands.<command>` is
`unsupported`, do not retry the same command; fall back to `rg`, `read`, or a
supported semantic command.

## Recommended combined workflow

```bash
# Step 0: inspect LSP availability for this file
slsp servers -f src/core/client.ts --format json

# Step 1: discover with rg
rg "SiyuanClient" src

# Step 2: map the file you care about
slsp symbols -f src/core/client.ts --format json

# Step 3: confirm a symbol's meaning
slsp hover       -f src/core/client.ts -l 30 -c 14 --format json
slsp definition  -f src/core/client.ts -l 30 -c 14 --format json

# Step 4: check blast radius before editing
slsp references  -f src/core/client.ts -l 30 -c 14 --format json

# Step 5: edit, then validate
slsp diagnostics -f src/core/client.ts --format json
```

## Where slsp adds the most value

**`symbols` — file orientation**

On an unfamiliar file, run `symbols` before reading line by line. It gives a
structured tree of top-level names, nested locals, and callbacks — faster than
scrolling.

**`references` — safe refactoring**

Before renaming or deleting a symbol, run `references`. The result is
semantically accurate: it filters out same-name-different-symbol matches that
`rg` would include, and it crosses file boundaries correctly.

**`diagnostics` — edit feedback loop**

After every code change, run `diagnostics`. An empty result means the language
server sees no type or syntax errors. This is not a substitute for running
tests, but it catches the most common mechanical mistakes immediately.

## Known limitation: complex module resolution

In TypeScript projects that use `moduleResolution: "Bundler"` with `.js`
import extensions (e.g. `import { foo } from './bar.js'`), `definition` may
resolve to the import statement in the current file rather than the actual
declaration in the target file. When that happens, follow up with:

```bash
rg "export.*function foo|export.*const foo" src
```

to locate the declaration directly.
