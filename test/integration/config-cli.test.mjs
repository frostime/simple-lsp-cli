import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, writeFixture, runCli } from "../helpers/cli-test-helpers.mjs";

const root = path.resolve("temp/test-config-cli");
const file = path.join(root, "sample.fake");
const fakeServer = path.join(root, "fake-lsp.mjs");

function writeFakeServer() {
  writeFixture(fakeServer, String.raw`
let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const sep = buffer.indexOf("\r\n\r\n");
    if (sep === -1) return;
    const header = buffer.slice(0, sep).toString("utf8");
    const match = header.match(/Content-Length: (\d+)/i);
    if (!match) process.exit(1);
    const length = Number(match[1]);
    const start = sep + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.slice(start, start + length).toString("utf8"));
    buffer = buffer.slice(start + length);
    handle(message);
  }
});

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body);
}

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { hoverProvider: true } } });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") process.exit(0);
  if (message.method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id: message.id, result: { contents: "fake hover" } });
  }
}
`);
}

test.before(() => {
  ensureDir(root);
  writeFixture(file, "fake content\n");
  writeFakeServer();
  writeFixture(path.join(root, "slsp.config.json"), JSON.stringify({
    schemaVersion: "1.0",
    servers: {
      fake: {
        command: process.execPath,
        args: [fakeServer],
        extensions: ["fake"],
        languageIds: { fake: "fake" },
      },
    },
    defaults: { fake: "fake" },
  }, null, 2));
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function runCliWithGlobalConfig(args) {
  const configHome = path.join(root, "xdg-cli");
  writeFixture(path.join(configHome, "simple-lsp-cli/slsp.config.json"), JSON.stringify({
    schemaVersion: "2.0",
    languages: {
      fake: { extensions: ["fake"], languageId: "fake", servers: ["fake"] },
    },
    servers: {
      fake: { command: process.execPath, args: [fakeServer] },
    },
  }, null, 2));
  return runCli(args, { env: { ...process.env, XDG_CONFIG_HOME: configHome } });
}

test("servers -f reports the selected configured server and command capabilities", () => {
  const result = runCli(["servers", "-f", file, "--format", "json"]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.equal(result.json?.result?.selected?.id, "fake");
  assert.equal(result.json?.result?.selected?.languageId, "fake");
  assert.equal(result.json?.result?.commands?.hover, "supported");
  assert.equal(result.json?.result?.commands?.format, "unsupported");
});

test("unsupported LSP command returns a machine-readable capability error", () => {
  const result = runCli(["format", "-f", file, "--no-daemon", "--format", "json"]);

  assert.equal(result.status, 1);
  assert.equal(result.json?.success, false);
  assert.equal(result.json?.error?.code, "unsupported_capability");
  assert.equal(result.json?.error?.server, "fake");
  assert.equal(result.json?.error?.capability, "documentFormattingProvider");
});

test("invalid project config returns config_error", () => {
  const badRoot = path.join(root, "bad-config");
  const badFile = path.join(badRoot, "sample.rs");
  writeFixture(badFile, "fn main() {}\n");
  writeFixture(path.join(badRoot, "slsp.config.json"), JSON.stringify({
    schemaVersion: "1.0",
    defaults: { rs: "missing" },
  }, null, 2));

  const result = runCli(["servers", "-f", badFile, "--format", "json"]);

  assert.equal(result.status, 1);
  assert.equal(result.json?.success, false);
  assert.equal(result.json?.error?.code, "config_error");
  assert.match(result.json?.error?.message, /unknown server/);
});

test("config reports global config path and effective summary", () => {
  const result = runCliWithGlobalConfig(["config", "--format", "json"]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.equal(result.json?.result?.schemaVersion, "2.0");
  assert.equal(result.json?.result?.loaded?.includes("global"), true);
  assert.equal(typeof result.json?.result?.languages, "number");
  assert.equal(typeof result.json?.result?.servers, "number");
});

test("languages lists configured language mappings", () => {
  const result = runCliWithGlobalConfig(["languages", "--format", "json"]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  const fake = result.json?.result?.find((language) => language.id === "fake");
  assert.deepEqual(fake?.extensions, ["fake"]);
  assert.equal(fake?.languageId, "fake");
  assert.deepEqual(fake?.servers, ["fake"]);
});
