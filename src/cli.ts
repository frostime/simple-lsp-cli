#!/usr/bin/env node

/**
 * simple-lsp-cli — CLI for invoking LSP methods.
 * Designed for AI agent tool use. All output is structured JSON.
 * Positions are 1-based.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LspClient } from "./lsp-client.js";
import { resolveServer, findServerName, SERVER_REGISTRY } from "./servers.js";
import { startDaemon, isDaemonRunning, sendToDaemon, type DaemonRequest } from "./daemon.js";
import { simplify, jsonOutput } from "./utils.js";

// ─── Minimal arg parser ──────────────────────────────────────

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  let command = "";
  let subcommand: string | undefined;

  const FLAG_ALIASES: Record<string, string> = {
    "-f": "--file",
    "-l": "--line",
    "-c": "--col",
    "-r": "--root",
    "-s": "--server",
    "-v": "--verbose",
    "-n": "--new-name",
    "-w": "--wait",
    "-h": "--help",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const resolved = FLAG_ALIASES[a] ?? a;

    if (resolved.startsWith("--")) {
      const key = resolved.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = a;
    } else if (!subcommand) {
      subcommand = a;
    }
  }

  return { command, subcommand, flags };
}

// ─── Helpers ──────────────────────────────────────────────────

function out(data: Parameters<typeof jsonOutput>[0]) {
  process.stdout.write(jsonOutput(data) + "\n");
}

function die(cmd: string, msg: string, file?: string): never {
  out({ success: false, command: cmd, file, error: msg });
  process.exit(1);
}

function requireFlag(flags: Record<string, string | boolean>, key: string, cmd: string): string {
  const val = flags[key];
  if (!val || val === true) die(cmd, `Missing required option: --${key}`);
  return val as string;
}

function numFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  const v = flags[key];
  if (v === undefined || v === true) return undefined;
  const n = parseInt(v as string, 10);
  return isNaN(n) ? undefined : n;
}

function findProjectRoot(filePath: string): string {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;
  const markers = [
    "package.json", "tsconfig.json", "pyproject.toml",
    "setup.py", "setup.cfg", ".git", "Cargo.toml", "go.mod",
    "pom.xml", "build.gradle",
  ];
  while (dir !== root) {
    for (const m of markers) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    dir = path.dirname(dir);
  }
  return path.dirname(path.resolve(filePath));
}

function resolveFileAndServer(flags: Record<string, string | boolean>, cmd: string) {
  const file = requireFlag(flags, "file", cmd);
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) die(cmd, `File not found: ${filePath}`, filePath);

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const preferred = flags.server && flags.server !== true ? (flags.server as string) : undefined;
  const config = resolveServer(ext, preferred);
  if (!config) {
    die(cmd, `No server for .${ext} files. Supported: py, ts, tsx, js, jsx, mjs, cjs`, filePath);
  }

  const serverName = preferred ?? findServerName(config);
  const rootPath = flags.root && flags.root !== true
    ? path.resolve(flags.root as string)
    : findProjectRoot(filePath);

  return { filePath, config, serverName, rootPath };
}

// ─── Command execution ───────────────────────────────────────

async function exec(
  cmd: string,
  flags: Record<string, string | boolean>,
  extra?: Record<string, unknown>
) {
  const { filePath, config, serverName, rootPath } = resolveFileAndServer(flags, cmd);
  const verbose = !!flags.verbose;
  const noDaemon = !!flags["no-daemon"];

  // Convert 1-based → 0-based
  const line = (numFlag(flags, "line") ?? 1) - 1;
  const col = (numFlag(flags, "col") ?? 1) - 1;

  // Try daemon first (unless --no-daemon)
  if (!noDaemon) {
    // Auto-start daemon if not running
    if (!isDaemonRunning()) {
      await startDaemonBackground(verbose);
      await new Promise(r => setTimeout(r, 800)); // Wait for startup
    }

    if (isDaemonRunning()) {
      try {
        const req: DaemonRequest = {
          id: `${Date.now()}`,
          method: cmd,
          params: { server: serverName, root: rootPath, file: filePath, line, character: col, ...extra },
        };
        const resp = await sendToDaemon(req);
        if (resp.error) die(cmd, resp.error.message, filePath);
        out({
          success: true,
          command: cmd,
          file: filePath,
          position: flags.line ? { line: line + 1, character: col + 1 } : undefined,
          result: simplify(resp.result),
        });
        return;
      } catch { /* fall through to inline */ }
    }
  }

  // Inline mode
  const client = new LspClient({ server: config, rootPath, verbose });
  try {
    await client.start();

    let result: unknown;
    switch (cmd) {
      case "hover":          result = await client.hover(filePath, line, col); break;
      case "definition":     result = await client.definition(filePath, line, col); break;
      case "typeDefinition": result = await client.typeDefinition(filePath, line, col); break;
      case "references":     result = await client.references(filePath, line, col); break;
      case "completion":     result = await client.completion(filePath, line, col); break;
      case "signatureHelp":  result = await client.signatureHelp(filePath, line, col); break;
      case "symbols":        result = await client.documentSymbols(filePath); break;
      case "format":         result = await client.formatting(filePath); break;
      case "diagnostics":
        result = await client.diagnostics(filePath, numFlag(flags, "wait") ?? 5000);
        break;
      case "rename":
        result = await client.rename(filePath, line, col, extra?.newName as string);
        break;
      case "codeActions":
        result = await client.codeActions(
          filePath, line, col,
          ((extra?.endLine as number) ?? line + 1) - 1,
          ((extra?.endCol as number) ?? col + 1) - 1
        );
        break;
      default:
        die(cmd, `Unknown command: ${cmd}`, filePath);
    }

    out({
      success: true,
      command: cmd,
      file: filePath,
      position: flags.line ? { line: line + 1, character: col + 1 } : undefined,
      result: simplify(result),
    });
  } catch (err) {
    die(cmd, err instanceof Error ? err.message : String(err), filePath);
  } finally {
    await client.stop();
  }
}

// ─── Help text ────────────────────────────────────────────────

function buildHelp(): string {
  const pkgRoot = path.resolve(fileURLToPath(import.meta.url), "../../");
  const skillPath = path.join(pkgRoot, "skills", "simple-lsp-cli", "SKILL.md");
  const skillLine = fs.existsSync(skillPath)
    ? `  ${skillPath}`
    : `  (not found locally) https://github.com/frostime/simple-lsp-cli/blob/main/skills/simple-lsp-cli/SKILL.md`;

  return `
simple-lsp-cli (slsp) — LSP operations from the command line.
Designed for AI agent tool use. All output is structured JSON.

USAGE:
  slsp <command> [options]

COMMANDS (position-based, need --file --line --col):
  hover              Type information and documentation
  definition         Go to definition
  type-definition    Go to type definition
  references         Find all references
  completion         Get completion suggestions
  signature-help     Get function signature info
  rename             Rename symbol (also needs --new-name)
  code-actions       Get code actions (optional --end-line --end-col)

COMMANDS (file-based, need --file):
  diagnostics        Errors, warnings, hints
  symbols            Document symbols (functions, classes, ...)
  format             Formatting edits

MANAGEMENT:
  daemon start       Start background daemon (add --foreground to block)
  daemon stop        Stop daemon
  daemon status      Check daemon status (shows idle time)
  servers            List configured language servers

NOTE: A daemon is auto-started on first LSP command and auto-stops
      after 15 minutes of inactivity. Manual start/stop is optional.

OPTIONS:
  -f, --file <path>       Target file (required)
  -l, --line <n>          Line number (1-based)
  -c, --col  <n>          Column number (1-based)
  -r, --root <path>       Project root (default: auto-detect)
  -s, --server <name>     Force server (pyright|pylsp|typescript)
  -n, --new-name <name>   New name (for rename)
  -w, --wait <ms>         Diagnostics wait time (default: 5000)
  -v, --verbose           Log LSP traffic to stderr
  --no-daemon             Force inline mode (skip daemon)
  -h, --help              Show this help

EXAMPLES:
  slsp hover -f src/main.py -l 10 -c 5
  slsp diagnostics -f src/app.ts
  slsp definition -f lib/utils.js -l 42 -c 12
  slsp symbols -f src/main.py
  slsp rename -f src/main.py -l 5 -c 8 --new-name newFunc
  slsp daemon start && slsp hover -f src/main.py -l 10 -c 5

AGENT SKILL:
  Read the SKILL.md for agent usage guide:
${skillLine}
`.trim();
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, subcommand, flags } = parsed;

  if (!command || flags.help) {
    console.log(buildHelp());
    process.exit(0);
  }

  switch (command) {
    // ── Position-based commands ──
    case "hover":
    case "definition":
    case "references":
    case "completion":
      if (!flags.line || !flags.col) die(command, "--line and --col are required");
      await exec(command, flags);
      break;

    case "type-definition":
      if (!flags.line || !flags.col) die("typeDefinition", "--line and --col are required");
      await exec("typeDefinition", flags);
      break;

    case "signature-help":
      if (!flags.line || !flags.col) die("signatureHelp", "--line and --col are required");
      await exec("signatureHelp", flags);
      break;

    case "rename": {
      if (!flags.line || !flags.col) die("rename", "--line and --col are required");
      const newName = requireFlag(flags, "new-name", "rename");
      await exec("rename", flags, { newName });
      break;
    }

    case "code-actions": {
      if (!flags.line || !flags.col) die("codeActions", "--line and --col are required");
      await exec("codeActions", flags, {
        endLine: numFlag(flags, "end-line"),
        endCol: numFlag(flags, "end-col"),
      });
      break;
    }

    // ── File-based commands ──
    case "diagnostics":
    case "symbols":
    case "format":
      await exec(command, flags);
      break;

    // ── Daemon ──
    case "daemon":
      await handleDaemon(subcommand, flags);
      break;

    // ── Servers ──
    case "servers":
      out({
        success: true,
        command: "servers",
        result: Object.entries(SERVER_REGISTRY).map(([id, c]) => ({
          id,
          name: c.name,
          command: c.command,
          extensions: c.extensions,
        })),
      });
      break;

    default:
      die(command, `Unknown command: ${command}. Run 'slsp --help' for usage.`);
  }
}

async function startDaemonBackground(verbose = false): Promise<boolean> {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "daemon", "start", "--foreground",
      ...(verbose ? ["--verbose"] : [])],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  await new Promise((r) => setTimeout(r, 600));
  return isDaemonRunning();
}

async function handleDaemon(sub: string | undefined, flags: Record<string, string | boolean>) {
  switch (sub) {
    case "start": {
      if (isDaemonRunning()) {
        out({ success: true, command: "daemon start", result: { status: "already_running" } });
        return;
      }
      if (flags.foreground) {
        await startDaemon(!!flags.verbose);
        return;
      }
      const started = await startDaemonBackground(!!flags.verbose);
      out({
        success: started,
        command: "daemon start",
        result: { status: started ? "started" : "failed" },
      });
      break;
    }
    case "stop":
      if (!isDaemonRunning()) {
        out({ success: true, command: "daemon stop", result: { status: "not_running" } });
        return;
      }
      try {
        const resp = await sendToDaemon({ id: "stop", method: "shutdown", params: {} });
        out({ success: true, command: "daemon stop", result: resp.result });
      } catch (e) { die("daemon stop", (e as Error).message); }
      break;

    case "status": {
      const running = isDaemonRunning();
      if (!running) {
        out({ success: true, command: "daemon status", result: { running: false } });
        return;
      }
      try {
        const resp = await sendToDaemon({ id: "st", method: "ping", params: {} });
        out({ success: true, command: "daemon status", result: { running: true, ...(resp.result as object ?? {}) } });
      } catch {
        out({ success: true, command: "daemon status", result: { running: false } });
      }
      break;
    }
    default:
      die("daemon", `Unknown subcommand: ${sub}. Use start|stop|status`);
  }
}

// ─── Go ───────────────────────────────────────────────────────

main().catch((err) => {
  die("cli", err instanceof Error ? err.message : String(err));
});
