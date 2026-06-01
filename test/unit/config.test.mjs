import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { loadEffectiveConfig, ConfigError } from "../../dist/config.js";

const root = path.resolve("temp/test-config");
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

function resetDir() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

test.beforeEach(() => {
  resetDir();
  process.env.XDG_CONFIG_HOME = path.join(root, "empty-xdg");
});
test.after(() => {
  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  fs.rmSync(root, { recursive: true, force: true });
});

test("project config can add a language server and make it the default for an extension", () => {
  const file = path.join(root, "src/main.rs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "fn main() {}\n", "utf8");
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "1.0",
    servers: {
      "rust-analyzer": {
        command: "rust-analyzer",
        args: [],
        extensions: ["rs"],
        languageIds: { rs: "rust" },
      },
    },
    defaults: { rs: "rust-analyzer" },
  });

  const effective = loadEffectiveConfig(file);

  assert.equal(effective.registry["rust-analyzer"].command, "rust-analyzer");
  assert.equal(effective.defaults.rs, "rust-analyzer");
  assert.equal(effective.languages.rust.languageId, "rust");
});

test("built-in Rust support selects rust-analyzer for rs files", () => {
  const effective = loadEffectiveConfig(root);

  assert.equal(effective.languages.rust.languageId, "rust");
  assert.deepEqual(effective.languages.rust.extensions, ["rs"]);
  assert.equal(effective.defaults.rs, "rust-analyzer");
  assert.equal(effective.registry["rust-analyzer"].command, "rust-analyzer");
});

test("v1 defaults can select a built-in server without redefining it", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "1.0",
    defaults: { py: "pylsp" },
  });

  const effective = loadEffectiveConfig(root);

  assert.equal(effective.defaults.py, "pylsp");
  assert.equal(effective.defaults.pyi, "pyright");
  assert.equal(effective.registry.pylsp.command, "pylsp");
});

test("v2 project config defines language-first custom server", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "2.0",
    languages: {
      latex: {
        extensions: ["tex", "cls", "sty"],
        languageId: "latex",
        servers: ["texlab"],
      },
      bibtex: {
        extensions: ["bib"],
        languageId: "bibtex",
        servers: ["texlab"],
      },
    },
    servers: {
      texlab: {
        command: "texlab",
        args: [],
        rootMarkers: [".latexmkrc"],
      },
    },
  });

  const effective = loadEffectiveConfig(root);

  assert.equal(effective.languages.latex.languageId, "latex");
  assert.deepEqual(effective.languages.latex.servers, ["texlab"]);
  assert.equal(effective.defaults.tex, "texlab");
  assert.equal(effective.registry.texlab.languageIds.tex, "latex");
  assert.equal(effective.registry.texlab.languageIds.bib, "bibtex");
});

test("global config is loaded before project config", () => {
  const oldXdg = process.env.XDG_CONFIG_HOME;
  const configHome = path.join(root, "xdg");
  process.env.XDG_CONFIG_HOME = configHome;
  try {
    writeJson(path.join(configHome, "simple-lsp-cli/slsp.config.json"), {
      schemaVersion: "2.0",
      languages: {
        fake: { extensions: ["fake"], languageId: "fake", servers: ["global-fake"] },
      },
      servers: {
        "global-fake": { command: "global-fake-lsp" },
      },
    });
    writeJson(path.join(root, "slsp.config.json"), {
      schemaVersion: "2.0",
      servers: {
        "global-fake": { command: "project-fake-lsp" },
      },
    });

    const effective = loadEffectiveConfig(root);

    assert.equal(effective.configPaths.global, path.join(configHome, "simple-lsp-cli/slsp.config.json"));
    assert.equal(effective.configPaths.project, path.join(root, "slsp.config.json"));
    assert.equal(effective.registry["global-fake"].command, "project-fake-lsp");
    assert.equal(effective.defaults.fake, "global-fake");
  } finally {
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldXdg;
  }
});

test("v2 rejects legacy defaults instead of silently ignoring them", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "2.0",
    defaults: { py: "pylsp" },
  });

  assert.throws(
    () => loadEffectiveConfig(root),
    (err) => err instanceof ConfigError && /Unsupported config field/.test(err.message),
  );
});

test("bad defaults fail fast instead of silently falling back", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "1.0",
    defaults: { rs: "missing-server" },
  });

  assert.throws(
    () => loadEffectiveConfig(root),
    (err) => err instanceof ConfigError && err.code === "config_error" && /unknown server/.test(err.message),
  );
});

test("extensions use dotless names", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "1.0",
    servers: {
      bad: {
        command: "bad-lsp",
        extensions: [".bad"],
        languageIds: { bad: "bad" },
      },
    },
  });

  assert.throws(
    () => loadEffectiveConfig(root),
    (err) => err instanceof ConfigError && /must not start with/.test(err.message),
  );
});

test("server language ids must match configured extensions", () => {
  writeJson(path.join(root, "slsp.config.json"), {
    schemaVersion: "1.0",
    servers: {
      bad: {
        command: "bad-lsp",
        extensions: ["rs"],
        languageIds: { py: "rust" },
      },
    },
  });

  assert.throws(
    () => loadEffectiveConfig(root),
    (err) => err instanceof ConfigError && /must include extension: rs/.test(err.message),
  );
});
