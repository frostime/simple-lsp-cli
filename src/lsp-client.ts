/**
 * LSP Client — manages a language server child process and provides
 * typed wrappers around standard LSP requests.
 */

import crossSpawn from "cross-spawn";
import { type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JsonRpcConnection } from "./jsonrpc.js";
import { type ServerConfig, getLanguageId } from "./servers.js";

// ─── Types ────────────────────────────────────────────────────

export interface LspClientOptions {
  server: ServerConfig;
  rootPath: string;
  timeout?: number;
  verbose?: boolean;
}

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
  relatedInformation?: unknown[];
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

// ─── Client ───────────────────────────────────────────────────

export class LspClient {
  private conn!: JsonRpcConnection;
  private proc!: ChildProcess;
  private diagnosticsMap = new Map<string, LspDiagnostic[]>();
  private diagnosticsWaiters = new Map<
    string,
    { resolve: (d: LspDiagnostic[]) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private openedFiles = new Set<string>();
  private alive = false;

  constructor(private opts: LspClientOptions) {}

  // ─── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    const { server, rootPath, verbose, timeout } = this.opts;
    this.log(`Spawning: ${server.command} ${server.args.join(" ")}`);

    this.proc = crossSpawn(server.command, server.args, {
      cwd: rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error(`Failed to spawn ${server.command} — no stdio`);
    }

    // Forward stderr in verbose mode
    this.proc.stderr?.on("data", (d: Buffer) => {
      if (verbose) process.stderr.write(`[${server.name}] ${d}`);
    });

    this.proc.on("error", (err) => {
      if (!this.alive) {
        throw new Error(
          `Cannot start "${server.command}": ${err.message}\n` +
          `Hint: install it first, e.g.  npm i -g pyright  or  npm i -g typescript typescript-language-server`
        );
      }
    });

    this.proc.on("exit", () => { this.alive = false; });

    this.conn = new JsonRpcConnection(
      this.proc.stdout,
      this.proc.stdin,
      timeout ?? 30_000,
      verbose
    );

    // Collect diagnostics
    this.conn.onNotification("textDocument/publishDiagnostics", (params) => {
      const p = params as { uri: string; diagnostics: LspDiagnostic[] };
      const key = normalizeUri(p.uri);
      this.diagnosticsMap.set(key, p.diagnostics);
      const w = this.diagnosticsWaiters.get(key);
      if (w && p.diagnostics.length > 0) {
        // Only resolve on non-empty diagnostics; empty may be an initial placeholder
        clearTimeout(w.timer);
        this.diagnosticsWaiters.delete(key);
        w.resolve(p.diagnostics);
      }
    });

    // Handle workspace/configuration requests from server
    this.conn.onRequest("workspace/configuration", () => {
      return [{}];
    });
    this.conn.onNotification("window/logMessage", () => {});
    this.conn.onNotification("window/showMessage", () => {});

    this.conn.listen();

    // Initialize
    const rootUri = pathToUri(rootPath);
    const result = (await this.conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      rootPath,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          definition: { linkSupport: false },
          typeDefinition: { linkSupport: false },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          formatting: {},
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: [] } } },
          rename: { prepareSupport: true },
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didSave: true },
        },
        workspace: {
          configuration: true,
          applyEdit: false,
        },
      },
      workspaceFolders: [{ uri: rootUri, name: path.basename(rootPath) }],
      initializationOptions: this.opts.server.initializationOptions ?? {},
    })) as Record<string, unknown>;

    this.conn.sendNotification("initialized", {});
    this.alive = true;
    this.log(`Server initialized (capabilities: ${Object.keys((result?.capabilities as object) ?? {}).length} items)`);
  }

  async stop(): Promise<void> {
    if (!this.alive) return;
    try {
      for (const uri of this.openedFiles) {
        this.conn.sendNotification("textDocument/didClose", {
          textDocument: { uri },
        });
      }
      await this.conn.sendRequest("shutdown", null, 5000);
      this.conn.sendNotification("exit", null);
    } catch { /* ok */ }
    this.conn.dispose();
    this.proc.kill();
    this.alive = false;
  }

  // ─── File Management ────────────────────────────────────────

  async openFile(filePath: string): Promise<string> {
    const abs = path.resolve(filePath);
    const uri = pathToUri(abs);
    if (this.openedFiles.has(uri)) return uri;

    const ext = path.extname(abs).slice(1);
    const langId = getLanguageId(this.opts.server, ext);
    const text = fs.readFileSync(abs, "utf-8");

    this.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: langId, version: 1, text },
    });
    this.openedFiles.add(uri);
    return uri;
  }

  // ─── LSP Methods ────────────────────────────────────────────

  async hover(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async definition(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async typeDefinition(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/typeDefinition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async references(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async completion(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async signatureHelp(file: string, line: number, character: number): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/signatureHelp", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async documentSymbols(file: string): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri },
    });
  }

  async formatting(file: string, tabSize = 4, insertSpaces = true): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize, insertSpaces },
    });
  }

  async rename(file: string, line: number, character: number, newName: string): Promise<unknown> {
    const uri = await this.openFile(file);
    return this.conn.sendRequest("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    });
  }

  async codeActions(
    file: string,
    startLine: number, startChar: number,
    endLine: number, endChar: number
  ): Promise<unknown> {
    const uri = await this.openFile(file);
    const diags = this.diagnosticsMap.get(uri) ?? [];
    return this.conn.sendRequest("textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      context: { diagnostics: diags },
    });
  }

  async diagnostics(file: string, waitMs = 5000): Promise<LspDiagnostic[]> {
    const uri = await this.openFile(file);
    const key = normalizeUri(uri);
    const existing = this.diagnosticsMap.get(key);
    if (existing && existing.length > 0) return existing;

    return new Promise<LspDiagnostic[]>((resolve) => {
      const timer = setTimeout(() => {
        this.diagnosticsWaiters.delete(key);
        resolve(this.diagnosticsMap.get(key) ?? []);
      }, waitMs);
      this.diagnosticsWaiters.set(key, { resolve, timer });
    });
  }

  // ─── Internal ───────────────────────────────────────────────

  private log(msg: string) {
    if (this.opts.verbose) process.stderr.write(`[slsp] ${msg}\n`);
  }
}

// ─── URI Helpers ──────────────────────────────────────────────

export function pathToUri(p: string): string {
  return pathToFileURL(path.resolve(p)).href;
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const localPath = fileURLToPath(uri);
  return localPath.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

/** Normalize a URI for use as a map key (lowercase drive, decode %3A). */
export function normalizeUri(uri: string): string {
  // Decode percent-encoded colon: %3A → :
  let normalized = uri.replace(/%3[Aa]/g, ":");
  // Lowercase the drive letter: file:///H: → file:///h:
  normalized = normalized.replace(/^file:\/\/\/([A-Z]):/, (_, d) => `file:///${d.toLowerCase()}:`);
  return normalized;
}
