import test from "node:test";
import assert from "node:assert/strict";

import { runCli } from "../helpers/cli-test-helpers.mjs";

test("--flag=value syntax is supported", () => {
  const result = runCli(["servers", "--format=json"]);
  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
  assert.ok(Array.isArray(result.json?.result));
});

test("unknown long option fails with unknown_option", () => {
  const result = runCli(["hover", "--zzz", "-f", "x.ts", "-l", "1", "-c", "1"]);
  assert.equal(result.status, 1);
  assert.equal(result.json?.error?.code, "unknown_option");
  assert.match(result.json?.error?.message, /--zzz/);
});

test("unknown --bad=value fails with unknown_option", () => {
  const result = runCli(["hover", "--bad=value", "-f", "x.ts", "-l", "1", "-c", "1"]);
  assert.equal(result.status, 1);
  assert.equal(result.json?.error?.code, "unknown_option");
  assert.match(result.json?.error?.message, /--bad/);
});

test("single-dash multi-char like -verbose fails with hint", () => {
  const result = runCli(["-verbose", "hover", "-f", "x.ts", "-l", "1", "-c", "1"]);
  assert.equal(result.status, 1);
  assert.equal(result.json?.error?.code, "unknown_option");
  assert.match(result.json?.error?.message, /Did you mean/);
});

test("--version outputs version string", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+$/);
});

test("-V outputs version string", () => {
  const result = runCli(["-V"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+$/);
});

test("subcommand --help shows command-specific help", () => {
  const result = runCli(["hover", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /hover/);
  assert.match(result.stdout, /--file/);
  // Should NOT contain the full global help sections
  assert.ok(!result.stdout.includes("MANAGEMENT:"));
});

test("--help without command shows global help", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /USAGE:/);
  assert.match(result.stdout, /COMMANDS/);
});

test("--no-daemon is accepted without error", () => {
  const result = runCli(["servers", "--no-daemon", "--format=json"]);
  assert.equal(result.status, 0);
  assert.equal(result.json?.success, true);
});

test("-- separator stops option parsing", () => {
  const result = runCli(["--", "--zzz"]);
  // --zzz becomes a positional (treated as unknown command), not an option error
  assert.equal(result.status, 1);
  assert.equal(result.json?.error?.code, "unknown_command");
});
