#!/usr/bin/env node

/**
 * simple-lsp-cli — CLI for invoking LSP methods.
 * Designed for AI agent tool use. Default output is compact text.
 * Use --format json for structured JSON output.
 * Positions are 1-based.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LspClient } from "./lsp-client.js";
import { resolveServer, findServerName, SERVER_REGISTRY, getLanguageId, type ServerConfig } from "./servers.js";
import { startDaemon, isDaemonRunning, sendToDaemon, type DaemonRequest } from "./daemon.js";
import { simplify, jsonOutput, type StructuredError } from "./utils.js";
import { formatResultText } from "./format.js";
import { ConfigError, getRootMarkers, loadEffectiveConfig, type EffectiveConfig } from "./config.js";
import { commandCapability, isCliCommand, type CliCommand } from "./capabilities.js";

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

function out(data: Parameters<typeof jsonOutput>[0]) {
  process.stdout.write(jsonOutput(data) + "\n");
}

function outText(text: string) {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function die(cmd: string, error: string | StructuredError, file?: string): never {
  out({ success: false, command: cmd, file, error: normalizeError(error) });
  process.exit(1);
}

function normalizeError(error: string | StructuredError): StructuredError {
  return typeof error === "string"
    ? { code: "command_error", message: error }
    : error;
}

function dieConfig(cmd: string, err: ConfigError, file?: string): never {
  die(cmd, err.toJson(), file);
}

function outputResult(args: {
  format: string;
  command: string;
  file: string;
  position?: { line: number; character: number };
  result: unknown;
}) {
  if (args.format === "json") {
    out({
      success: true,
      command: args.command,
      file: args.file,
      position: args.position,
      result: simplify(args.result),
    });
    return;
  }

  outText(formatResultText({
    command: args.command,
    file: args.file,
    position: args.position,
    result: simplify(args.result),
  }));
}

function requireFlag(flags: Record<string, string | boolean>, key: string, cmd: string): string {
  const val = flags[key];
  if (!val || val === true) die(cmd, { code: "missing_option", message: `Missing required option: --${key}` });
  return val as string;
}

function numFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  const v = flags[key];
  if (v === undefined || v === true) return undefined;
  const n = parseInt(v as string, 10);
  return isNaN(n) ? undefined : n;
}

function outputFormat(flags: Record<string, string | boolean>, cmd: string): string {
  const format = flags.format && flags.format !== true ? String(flags.format) : "text";
  if (format !== "text" && format !== "json") {
    die(cmd, { code: "invalid_format", message: `Unsupported format: ${format}. Use --format text|json` });
  }
  return format;
}

function findProjectRoot(filePath: string, markers: string[]): string {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const m of markers) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    dir = path.dirname(dir);
  }
  return path.dirname(path.resolve(filePath));
}

function supportedExtensions(registry: Record<string, ServerConfig>): string {
  return Array.from(new Set(Object.values(registry).flatMap((c) => c.extensions))).sort().join(", ");
}

function loadEffective(cmd: string, startPath: string, file?: string): EffectiveConfig {
  try {
    return loadEffectiveConfig(startPath);
  } catch (err) {
    if (err instanceof ConfigError) dieConfig(cmd, err, file);
    throw err;
  }
}

function resolveFileAndServer(flags: Record<string, string | boolean>, cmd: string) {
  const file = requireFlag(flags, "file", cmd);
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) die(cmd, { code: "file_not_found", message: `File not found: ${filePath}` }, filePath);

  const effective = loadEffective(cmd, filePath, filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const preferred = flags.server && flags.server !== true ? (flags.server as string) : undefined;
  const config = resolveServer(ext, preferred, effective.registry, effective.defaults);
  if (!config) {
    die(cmd, { code: "server_resolution_error", message: `No server for .${ext} files. Supported: ${supportedExtensions(effective.registry)}` }, filePath);
  }

  const serverName = preferred ?? findServerName(config, effective.registry);
  const rootPath = flags.root && flags.root !== true
    ? path.resolve(flags.root as string)
    : findProjectRoot(filePath, getRootMarkers(config));

  return { filePath, ext, config, serverName, rootPath, effective };
}

function unsupportedError(args: {
  command: CliCommand;
  serverName: string;
  client: LspClient;
}): StructuredError {
  return {
    code: "unsupported_capability",
    message: `${args.command} is not supported by ${args.serverName}`,
    server: args.serverName,
    capability: commandCapability(args.command),
    supportedCommands: Object.entries(args.client.supportedCommands())
      .filter(([, support]) => support !== "unsupported")
      .map(([command]) => command),
  };
}

async function exec(
  cmd: CliCommand,
  flags: Record<string, string | boolean>,
  extra?: Record<string, unknown>
) {
  const { filePath, config, serverName, rootPath, effective } = resolveFileAndServer(flags, cmd);
  const verbose = !!flags.verbose;
  const noDaemon = !!flags["no-daemon"];
  const format = outputFormat(flags, cmd);

  const line = (numFlag(flags, "line") ?? 1) - 1;
  const col = (numFlag(flags, "col") ?? 1) - 1;

  if (!noDaemon) {
    if (!isDaemonRunning()) {
      await startDaemonBackground(verbose);
      await new Promise(r => setTimeout(r, 800));
    }

    if (isDaemonRunning()) {
      try {
        const req: DaemonRequest = {
          id: `${Date.now()}`,
          method: cmd,
          params: {
            server: serverName,
            serverConfig: config,
            root: rootPath,
            configFingerprint: effective.fingerprint,
            file: filePath,
            line,
            character: col,
            ...extra,
          },
        };
        const resp = await sendToDaemon(req);
        if (resp.error) die(cmd, resp.error, filePath);
        outputResult({
          format,
          command: cmd,
          file: filePath,
          position: flags.line ? { line: line + 1, character: col + 1 } : undefined,
          result: resp.result,
        });
        return;
      } catch { /* fall through to inline */ }
    }
  }

  const client = new LspClient({ server: config, rootPath, verbose });
  try {
    await client.start();
    if (!client.supports(cmd)) die(cmd, unsupportedError({ command: cmd, serverName, client }), filePath);

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
      case "diagnostics":    result = await client.diagnostics(filePath, numFlag(flags, "wait") ?? 5000); break;
      case "rename":         result = await client.rename(filePath, line, col, extra?.newName as string); break;
      case "codeActions":
        result = await client.codeActions(
          filePath, line, col,
          ((extra?.endLine as number) ?? line + 1) - 1,
          ((extra?.endCol as number) ?? col + 1) - 1
        );
        break;
    }

    outputResult({
      format,
      command: cmd,
      file: filePath,
      position: flags.line ? { line: line + 1, character: col + 1 } : undefined,
      result,
    });
  } catch (err) {
    if (err instanceof ConfigError) dieConfig(cmd, err, filePath);
    die(cmd, err instanceof Error ? err.message : String(err), filePath);
  } finally {
    await client.stop();
  }
}

async function handleServers(flags: Record<string, string | boolean>) {
  const format = outputFormat(flags, "servers");
  const fileFlag = flags.file && flags.file !== true ? String(flags.file) : undefined;

  if (!fileFlag) {
    const effective = loadEffective("servers", process.cwd());
    const result = Object.entries(effective.registry).map(([id, c]) => ({
      id,
      name: c.name,
      command: c.command,
      args: c.args,
      extensions: c.extensions,
      configPath: effective.configPath,
    }));
    if (format === "json") out({ success: true, command: "servers", result });
    else outText(result.map((s) => `${s.id}\t${s.command} ${s.args.join(" ")}\t.${s.extensions.join(", .")}`).join("\n"));
    return;
  }

  const { filePath, ext, config, serverName, rootPath, effective } = resolveFileAndServer(flags, "servers");
  const verbose = !!flags.verbose;
  const client = new LspClient({ server: config, rootPath, verbose });
  try {
    await client.start();
    const result = {
      selected: {
        id: serverName,
        name: config.name,
        command: config.command,
        args: config.args,
        root: rootPath,
        languageId: getLanguageId(config, ext),
        configPath: effective.configPath ?? null,
      },
      commands: client.supportedCommands(),
    };
    if (format === "json") out({ success: true, command: "servers", file: filePath, result });
    else {
      outText([
        `server: ${result.selected.id}`,
        `root: ${result.selected.root}`,
        `languageId: ${result.selected.languageId}`,
        `config: ${result.selected.configPath ?? "(none)"}`,
        ...Object.entries(result.commands).map(([cmdName, support]) => `${cmdName}: ${support}`),
      ].join("\n"));
    }
  } catch (err) {
    if (err instanceof ConfigError) dieConfig("servers", err, filePath);
    die("servers", err instanceof Error ? err.message : String(err), filePath);
  } finally {
    await client.stop();
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function findDocsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "docs"),
    path.resolve(here, "../src/docs"),
    path.resolve(here, "../../src/docs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function buildDocsSection(): string {
  const docsDir = findDocsDir();
  if (!docsDir) return "  (bundled docs not found — reinstall the package to recover them)";
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) return `  (no docs found in ${docsDir})`;

  const lines: string[] = [
    "  The following Mini-SKILL docs are bundled with this CLI. Agents: read",
    "  them directly from the filesystem to learn proper usage.",
    "",
    `  Docs directory: ${docsDir}`,
    "",
  ];
  for (const f of files) {
    const full = path.join(docsDir, f);
    let meta: Record<string, string> = {};
    try { meta = parseFrontmatter(fs.readFileSync(full, "utf-8")); } catch { /* ok */ }
    const name = meta.name || f.replace(/\.md$/, "");
    const desc = meta.description || "(no description)";
    lines.push(`  • ${name}`);
    lines.push(`      path: ${full}`);
    lines.push(`      ${desc}`);
  }
  return lines.join("\n");
}

function buildHelp(): string {
  return `
simple-lsp-cli (slsp) — LSP operations from the command line.
Designed for AI agent tool use. Default output is compact text.
Use --format json for structured JSON output.

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
  servers -f <file>  Inspect selected server and command capabilities

OPTIONS:
  -f, --file <path>       Target file
  -l, --line <n>          Line number (1-based)
  -c, --col  <n>          Column number (1-based)
  -r, --root <path>       Project root (default: auto-detect)
  -s, --server <name>     Force server
  -n, --new-name <name>   New name (for rename)
  -w, --wait <ms>         Diagnostics wait time (default: 5000)
  -v, --verbose           Log LSP traffic to stderr
  --format <text|json>    Output format (default: text)
  --no-daemon             Force inline mode (skip daemon)
  -h, --help              Show this help

CONFIG:
  slsp.config.json        Project-local server registry extension

EXAMPLES:
  slsp servers -f src/main.py --format json
  slsp hover -f src/main.py -l 10 -c 5
  slsp diagnostics -f src/app.ts
  slsp definition -f lib/utils.js -l 42 -c 12
  slsp rename -f src/main.py -l 5 -c 8 --new-name newFunc

AGENT DOCS:
${buildDocsSection()}
`.trim();
}

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, subcommand, flags } = parsed;

  if (!command || flags.help) {
    console.log(buildHelp());
    process.exit(0);
  }

  switch (command) {
    case "hover":
    case "definition":
    case "references":
    case "completion":
      if (!flags.line || !flags.col) die(command, { code: "missing_option", message: "--line and --col are required" });
      await exec(command, flags);
      break;

    case "type-definition":
      if (!flags.line || !flags.col) die("typeDefinition", { code: "missing_option", message: "--line and --col are required" });
      await exec("typeDefinition", flags);
      break;

    case "signature-help":
      if (!flags.line || !flags.col) die("signatureHelp", { code: "missing_option", message: "--line and --col are required" });
      await exec("signatureHelp", flags);
      break;

    case "rename": {
      if (!flags.line || !flags.col) die("rename", { code: "missing_option", message: "--line and --col are required" });
      const newName = requireFlag(flags, "new-name", "rename");
      await exec("rename", flags, { newName });
      break;
    }

    case "code-actions": {
      if (!flags.line || !flags.col) die("codeActions", { code: "missing_option", message: "--line and --col are required" });
      await exec("codeActions", flags, {
        endLine: numFlag(flags, "end-line"),
        endCol: numFlag(flags, "end-col"),
      });
      break;
    }

    case "diagnostics":
    case "symbols":
    case "format":
      await exec(command, flags);
      break;

    case "daemon":
      await handleDaemon(subcommand, flags);
      break;

    case "servers":
      await handleServers(flags);
      break;

    default:
      die(command, { code: "unknown_command", message: `Unknown command: ${command}. Run 'slsp --help' for usage.` });
  }
}

async function startDaemonBackground(verbose = false): Promise<boolean> {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "daemon", "start", "--foreground",
      ...(verbose ? ["--verbose"] : [])],
    { detached: true, stdio: "ignore", windowsHide: true }
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
      out({ success: started, command: "daemon start", result: { status: started ? "started" : "failed" } });
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
      die("daemon", { code: "unknown_subcommand", message: `Unknown subcommand: ${sub}. Use start|stop|status` });
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) dieConfig("cli", err);
  die("cli", err instanceof Error ? err.message : String(err));
});
