import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { loadEffectiveConfig, ConfigError } from "../../dist/config.js";

const root = path.resolve("temp/test-config");

function resetDir() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

test.beforeEach(resetDir);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

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
