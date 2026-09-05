import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, writeFixture, runCli } from "../helpers/cli-test-helpers.mjs";

const root = path.resolve("temp/test-daemon-sync");
const fakeServer = path.join(root, "fake-lsp.mjs");
const logFile = path.join(root, "events.jsonl");
const configFile = path.join(root, "slsp.config.json");
const env = { XDG_CONFIG_HOME: path.join(root, "empty-xdg") };

function writeFakeServer() {
  writeFixture(fakeServer, String.raw`
import fs from "node:fs";

const mode = process.argv[2];
const eventFile = process.argv[3];
const documents = new Map();
let buffer = Buffer.alloc(0);

function record(message) {
  fs.appendFileSync(eventFile, JSON.stringify(message) + "\n", "utf8");
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body);
}

function endPosition(text) {
  const lines = text.split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function publish(uri, document) {
  const params = {
    uri,
    diagnostics: document.text.includes("bad")
      ? [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          severity: 1,
          message: "fake diagnostic",
          source: "fake",
        }]
      : [],
  };
  if (mode === "options") params.version = document.version;
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
}

function handle(message) {
  record(message);

  if (message.method === "initialize") {
    const textDocumentSync = mode === "numeric" || mode === "full"
      ? (mode === "full" ? 1 : 2)
      : mode === "none"
        ? 0
        : mode === "reopen"
          ? { openClose: true }
          : mode === "noopen"
            ? { change: 2 }
            : { openClose: true, change: 2 };
    send({ jsonrpc: "2.0", id: message.id, result: {
      capabilities: { hoverProvider: true, textDocumentSync },
    } });
    return;
  }
  if (message.method === "workspace/configuration") {
    send({ jsonrpc: "2.0", id: message.id, result: [{}] });
    return;
  }
  if (message.method === "client/registerCapability" || message.method === "client/unregisterCapability") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
    return;
  }
  if (message.method === "textDocument/didOpen") {
    const item = message.params.textDocument;
    const document = { text: item.text, version: item.version };
    documents.set(item.uri, document);
    publish(item.uri, document);
    return;
  }
  if (message.method === "textDocument/didClose") {
    documents.delete(message.params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/didChange") {
    const uri = message.params.textDocument.uri;
    const document = documents.get(uri);
    const change = message.params.contentChanges[0];
    if (!document) throw new Error("change for unopened document");
    if (mode !== "full") {
      assertRange(change.range, document.text);
    }
    document.text = change.text;
    document.version = message.params.textDocument.version;
    publish(uri, document);
    return;
  }
  if (message.method === "textDocument/hover") {
    const uri = message.params.textDocument.uri;
    send({ jsonrpc: "2.0", id: message.id, result: { contents: documents.get(uri)?.text ?? "closed" } });
  }
}

function assertRange(range, oldText) {
  const expected = endPosition(oldText);
  if (range.start.line !== 0 || range.start.character !== 0 ||
      range.end.line !== expected.line || range.end.character !== expected.character) {
    throw new Error("unexpected incremental replacement range");
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) return;
    const header = buffer.subarray(0, separator).toString("utf8");
    const match = header.match(/Content-Length: (\d+)/i);
    if (!match) process.exit(1);
    const length = Number(match[1]);
    const start = separator + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
    buffer = buffer.subarray(start + length);
    handle(message);
  }
});
`);
}

function writeConfig() {
  writeFixture(configFile, JSON.stringify({
    schemaVersion: "2.0",
    languages: {
      numeric: { extensions: ["fake"], languageId: "fake", servers: ["fake-numeric"] },
      options: { extensions: ["opt"], languageId: "fake", servers: ["fake-options"] },
      full: { extensions: ["full"], languageId: "fake", servers: ["fake-full"] },
      reopen: { extensions: ["reopen"], languageId: "fake", servers: ["fake-reopen"] },
      none: { extensions: ["none"], languageId: "fake", servers: ["fake-none"] },
      noopen: { extensions: ["noopen"], languageId: "fake", servers: ["fake-noopen"] },
    },
    servers: Object.fromEntries([
      ["fake-numeric", "numeric"],
      ["fake-options", "options"],
      ["fake-full", "full"],
      ["fake-reopen", "reopen"],
      ["fake-none", "none"],
      ["fake-noopen", "noopen"],
    ].map(([id, mode]) => [id, {
      command: process.execPath,
      args: [fakeServer, mode, logFile],
    }])),
  }, null, 2));
}

function file(extension, content = "bad\n") {
  const filePath = path.join(root, `sample.${extension}`);
  writeFixture(filePath, content);
  return filePath;
}

function run(args) {
  return runCli(args, { env });
}

function stopDaemon() {
  run(["daemon", "stop", "--format", "json"]);
  run(["daemon", "status", "--format", "json"]);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
}

function clearEvents() {
  fs.writeFileSync(logFile, "", "utf8");
}

function events() {
  return fs.readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertSuccessfulDiagnostics(result, expectedCount) {
  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.equal(result.json?.result?.length, expectedCount);
}

test.before(() => {
  ensureDir(root);
  writeFakeServer();
  writeConfig();
  clearEvents();
});

test.after(() => {
  stopDaemon();
  fs.rmSync(root, { recursive: true, force: true });
});

test("daemon refreshes numeric incremental documents and clears unversioned diagnostics", () => {
  stopDaemon();
  clearEvents();
  const target = file("fake", "😀bad");

  assertSuccessfulDiagnostics(run(["diagnostics", "-f", target, "--wait", "1000", "--format", "json"]), 1);
  assertSuccessfulDiagnostics(run(["diagnostics", "-f", target, "--wait", "1000", "--format", "json"]), 1);

  writeFixture(target, "good\n");
  assertSuccessfulDiagnostics(run(["diagnostics", "-f", target, "--wait", "1000", "--format", "json"]), 0);

  const messages = events();
  assert.equal(messages.filter((message) => message.method === "textDocument/didOpen").length, 1);
  const changes = messages.filter((message) => message.method === "textDocument/didChange");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].params.textDocument.version, 2);
  assert.deepEqual(changes[0].params.contentChanges[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 5 },
  });
});

test("daemon uses versioned diagnostics with options-object incremental sync", () => {
  stopDaemon();
  clearEvents();
  const target = file("opt");

  assertSuccessfulDiagnostics(run(["diagnostics", "-f", target, "--wait", "1000", "--format", "json"]), 1);
  writeFixture(target, "good\n");
  assertSuccessfulDiagnostics(run(["diagnostics", "-f", target, "--wait", "1000", "--format", "json"]), 0);

  const changes = events().filter((message) => message.method === "textDocument/didChange");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].params.textDocument.version, 2);
});

test("daemon sends full changes to a Full-sync server", () => {
  stopDaemon();
  clearEvents();
  const target = file("full");

  assert.equal(run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]).status, 0);
  writeFixture(target, "new\n");
  const result = run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]);
  assert.equal(result.json?.result?.contents, "new\n");

  const change = events().find((message) => message.method === "textDocument/didChange");
  assert.deepEqual(change?.params.contentChanges, [{ text: "new\n" }]);
});

test("daemon reopens documents only when the server permits lifecycle sync", () => {
  stopDaemon();
  clearEvents();
  const target = file("reopen");

  assert.equal(run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]).status, 0);
  writeFixture(target, "new\n");
  const result = run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]);
  assert.equal(result.json?.result?.contents, "new\n");

  const methods = events().map((message) => message.method);
  assert.deepEqual(methods.filter((method) => method === "textDocument/didClose").length, 1);
  assert.equal(methods.filter((method) => method === "textDocument/didOpen").length, 2);
});

test("daemon rejects an options object that omits openClose", () => {
  stopDaemon();
  clearEvents();
  const target = file("noopen");

  const result = run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]);
  assert.equal(result.status, 1);
  assert.equal(result.json?.success, false);
  assert.match(result.json?.error?.message ?? "", /does not allow open\/close/);
});

test("daemon rejects a server that does not advertise document synchronization", () => {
  stopDaemon();
  clearEvents();
  const target = file("none");

  const result = run(["hover", "-f", target, "-l", "1", "-c", "1", "--format", "json"]);
  assert.equal(result.status, 1);
  assert.equal(result.json?.success, false);
  assert.match(result.json?.error?.message ?? "", /text document synchronization/);
});
