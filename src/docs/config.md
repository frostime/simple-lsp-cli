---
name: slsp-config
description: Configure slsp language mappings and LSP server launch definitions. Read when adding a language/server, using global config, or debugging config_error.
---

# slsp Config

## Mental model

`slsp` maps a file path to an LSP server call in two steps:

```text
file extension → language config → ordered server list → server launch config
```

| Config object | Owns | Example |
|---|---|---|
| `languages` | file recognition, LSP `languageId`, server priority | `.tex` → `latex` → `texlab` |
| `servers` | process launch and server-specific options | `texlab`, `rust-analyzer` |

This mirrors common LSP client configuration: language/filetype metadata is
separate from server process configuration.

## Config locations

Merge order:

```text
built-in < global < project
```

| Layer | Path |
|---|---|
| global | `$XDG_CONFIG_HOME/simple-lsp-cli/slsp.config.json` |
| global fallback | `~/.config/simple-lsp-cli/slsp.config.json` |
| project | nearest `slsp.config.json` found by walking up from the target file |

Later layers replace entries with the same key:

| Field | Merge rule |
|---|---|
| `languages.<id>` | replaced as a whole |
| `servers.<id>` | replaced as a whole |
| `languages.<id>.servers` | ordered; first server is default |

Inspect effective config:

```bash
slsp config --format json
slsp languages --format json
```

## Current schema

Use `schemaVersion: "2.0"` for new config:

```json
{
  "$schema": "https://raw.githubusercontent.com/frostime/simple-lsp-cli/main/schema/slsp.schema.json",
  "schemaVersion": "2.0",
  "languages": {
    "rust": {
      "extensions": ["rs"],
      "languageId": "rust",
      "servers": ["rust-analyzer"]
    }
  },
  "servers": {
    "rust-analyzer": {
      "name": "Rust Analyzer",
      "command": "rust-analyzer",
      "args": [],
      "transport": "stdio",
      "rootMarkers": ["Cargo.toml", "rust-project.json"]
    }
  }
}
```

## Add a new LSP server

Requirements:

| Requirement | Current support |
|---|---|
| LSP JSON-RPC server | required |
| stdio transport | required |
| TCP/socket transport | not supported |
| custom command/args/env | supported |
| initialization options | supported |

### TexLab example

If `texlab` is installed and available on `PATH`:

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
      "rootMarkers": [".latexmkrc", "Tectonic.toml", ".git"]
    }
  }
}
```

Then verify:

```bash
slsp languages --format json
slsp servers -f paper.tex --format json
```

## v1 compatibility

`schemaVersion: "1.0"` config is still accepted and migrated in memory.
New config should use v2.

Legacy v1 shape:

```json
{
  "schemaVersion": "1.0",
  "servers": {
    "example-lsp": {
      "command": "example-lsp",
      "extensions": ["ex"],
      "languageIds": { "ex": "example" }
    }
  },
  "defaults": { "ex": "example-lsp" }
}
```

Migration semantics:

| v1 field | v2 destination |
|---|---|
| `servers.*.extensions` | `languages.*.extensions` |
| `servers.*.languageIds` | `languages.*.languageId` |
| `defaults.<ext>` | `languages.*.servers[0]` |
| server `command/args/env/rootMarkers/initializationOptions` | `servers.*` |

If multiple v1 servers declare the same extension and no `defaults` entry
chooses one, config loading fails with `config_error`.

## Troubleshooting

| Error | Meaning | Fix |
|---|---|---|
| `config_error` | config failed validation or migration | Run `slsp config --format json`; inspect the reported file |
| `No server for .xxx files` | no language maps that extension | add `languages.<id>.extensions` and `servers` |
| `Cannot start` / `ENOENT` | server executable missing | install server or use absolute `command` |
| `unsupported_capability` | server started but lacks the LSP capability | choose another command/server |

Bad config is fail-fast. `slsp` does not silently fall back to built-ins when a
loaded user config is invalid.
