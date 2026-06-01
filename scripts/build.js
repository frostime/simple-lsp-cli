#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, parse } from "node:path";
import { fileURLToPath } from "node:url";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.chdir(dirname(fileURLToPath(import.meta.url)));
while (!existsSync("package.json")) {
  const cwd = process.cwd();
  const parent = dirname(cwd);
  if (cwd === parse(cwd).root || parent === cwd) {
    console.error("Cannot find package.json from build script location");
    process.exit(1);
  }
  process.chdir(parent);
}

rmSync("dist", { recursive: true, force: true });
run("tsc", []);

if (!existsSync("src/docs")) {
  console.error("Missing required docs directory: src/docs");
  process.exit(1);
}

mkdirSync("dist", { recursive: true });
cpSync("src/docs", "dist/docs", { recursive: true });

if (existsSync("schema")) {
  cpSync("schema", "dist/schema", { recursive: true });
}
