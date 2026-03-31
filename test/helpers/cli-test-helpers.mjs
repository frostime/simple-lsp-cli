import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFixture(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    ...options,
  });

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  let json = null;

  if (stdout) {
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
  }

  return { ...result, stdout, stderr, json };
}
