import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, writeFixture, runCli } from "../helpers/cli-test-helpers.mjs";

const root = path.resolve("temp/test-cli");
const tsFile = path.join(root, "sample.ts");
const txtFile = path.join(root, "sample.txt");

function normalizePathCase(filePath) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

test.before(() => {
  ensureDir(root);
  writeFixture(tsFile, [
    "function greet(name: string) {",
    "  return `Hello, ${name.toUpperCase()}`;",
    "}",
    "",
    "const user = 'world';",
    "const result = greet(user);",
    "const broken: number = greet(user);",
    "console.log(result);",
    "",
  ].join("\n"));
  writeFixture(txtFile, "hello\n");
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  runCli(["daemon", "stop"]);
});

test("servers command returns configured servers", () => {
  const result = runCli(["servers"]);
  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.ok(Array.isArray(result.json?.result));
  assert.ok(result.json.result.some((server) => server.id === "typescript"));
});

test("definition returns decoded local file paths", () => {
  const result = runCli([
    "definition",
    "-f", tsFile,
    "-l", "6",
    "-c", "16",
    "--no-daemon",
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.equal(
    normalizePathCase(result.json?.result?.[0]?.file),
    normalizePathCase(tsFile),
  );
});

test("format returns 1-based text edit ranges", () => {
  const result = runCli(["format", "-f", tsFile, "--no-daemon"]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.ok(result.json?.result?.[0]?.range?.start?.line >= 1);
  assert.ok(result.json?.result?.[0]?.range?.start?.character >= 1);
  assert.ok(result.json?.result?.[0]?.range?.end?.line >= 1);
  assert.ok(result.json?.result?.[0]?.range?.end?.character >= 1);
});

test("daemon mode returns decoded local file paths", () => {
  runCli(["daemon", "stop"]);
  const result = runCli(["definition", "-f", tsFile, "-l", "6", "-c", "16"]);

  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.equal(
    normalizePathCase(result.json?.result?.[0]?.file),
    normalizePathCase(tsFile),
  );
});

test("unsupported file types fail with structured JSON", () => {
  const result = runCli(["diagnostics", "-f", txtFile, "--no-daemon"]);

  assert.equal(result.status, 1);
  assert.equal(result.json?.success, false);
  assert.match(result.json?.error ?? "", /No server for \.txt files/);
});
