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
import { commandSupport, listSupportedCommands, type CliCommand, type CommandSupport } from "./capabilities.js";

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

type TextDocumentSyncKind = 0 | 1 | 2;

interface TextDocumentSyncOptions {
  openClose?: boolean;
  change?: TextDocumentSyncKind;
}

type DocumentSyncPlan =
  | { kind: "change"; syncKind: 1 | 2 }
  | { kind: "reopen" }
  | { kind: "unsupported"; reason: string };

interface DocumentState {
  uri: string;
  languageId: string;
  text: string;
  version: number;
  diagnosticGeneration: number;
}

interface DiagnosticCache {
  diagnostics: LspDiagnostic[];
  version?: number;
  generation: number;
}

interface DiagnosticWaiter {
  generation: number;
  resolve: (diagnostics: LspDiagnostic[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}

// ─── Client ───────────────────────────────────────────────────

export class LspClient {
  private conn!: JsonRpcConnection;
  private proc!: ChildProcess;
  private diagnosticsMap = new Map<string, DiagnosticCache>();
  private diagnosticsWaiters = new Map<string, DiagnosticWaiter[]>();
  private documents = new Map<string, DocumentState>();
  private capabilities: Record<string, unknown> | null = null;
  private documentSyncPlan: DocumentSyncPlan | null = null;
  private alive = false;

  constructor(private opts: LspClientOptions) {}

  // ─── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    const { server, rootPath, verbose, timeout } = this.opts;
    this.log(`Spawning: ${server.command} ${server.args.join(" ")}`);

    this.proc = crossSpawn(server.command, server.args, {
      cwd: rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(server.env ?? {}) },
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
      this.handleDiagnostics(params as PublishDiagnosticsParams);
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
        general: {
          positionEncodings: ["utf-16"],
        },
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
          publishDiagnostics: { relatedInformation: true, versionSupport: true },
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

    this.capabilities = (result?.capabilities as Record<string, unknown> | undefined) ?? null;
    this.documentSyncPlan = getDocumentSyncPlan(this.capabilities);
    this.conn.sendNotification("initialized", {});
    this.alive = true;
    this.log(`Server initialized (capabilities: ${Object.keys(this.capabilities ?? {}).length} items)`);
  }

  async stop(): Promise<void> {
    if (!this.alive) return;
    try {
      for (const document of this.documents.values()) {
        if (this.documentSyncPlan?.kind !== "unsupported") {
          this.conn.sendNotification("textDocument/didClose", {
            textDocument: { uri: document.uri },
          });
        }
      }
      await this.conn.sendRequest("shutdown", null, 5000);
      this.conn.sendNotification("exit", null);
    } catch { /* ok */ }
    this.conn.dispose();
    this.proc.kill();
    this.alive = false;
  }

  // ─── Capabilities ────────────────────────────────────────────

  getCapabilities(): Record<string, unknown> | null {
    return this.capabilities;
  }

  commandSupport(command: CliCommand): CommandSupport {
    return commandSupport(command, this.capabilities);
  }

  supports(command: CliCommand): boolean {
    return this.commandSupport(command) !== "unsupported";
  }

  supportedCommands(): Record<CliCommand, CommandSupport> {
    return listSupportedCommands(this.capabilities);
  }

  // ─── File Management ────────────────────────────────────────

  async openFile(filePath: string): Promise<string> {
    const abs = path.resolve(filePath);
    const uri = pathToUri(abs);
    const key = normalizeUri(uri);
    const plan = this.documentSyncPlan;

    if (!plan || plan.kind === "unsupported") {
      throw new Error(plan?.reason ?? "Language server synchronization is not initialized");
    }

    const ext = path.extname(abs).slice(1);
    const languageId = getLanguageId(this.opts.server, ext);
    const text = fs.readFileSync(abs, "utf-8");
    const current = this.documents.get(key);

    if (!current) {
      this.documents.set(key, {
        uri,
        languageId,
        text,
        version: 1,
        diagnosticGeneration: 0,
      });
      this.conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
      return uri;
    }

    if (current.text === text) return uri;

    const previousText = current.text;
    const nextVersion = current.version + 1;
    current.text = text;
    current.version = nextVersion;
    current.diagnosticGeneration += 1;
    this.diagnosticsMap.delete(key);

    if (plan.kind === "reopen") {
      this.conn.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
      this.conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: current.languageId, version: nextVersion, text },
      });
    } else {
      const contentChange = plan.syncKind === 1
        ? { text }
        : { range: { start: { line: 0, character: 0 }, end: documentEndPosition(previousText) }, text };
      this.conn.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: nextVersion },
        contentChanges: [contentChange],
      });
    }

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
    const key = normalizeUri(uri);
    const diags = this.diagnosticsMap.get(key)?.diagnostics ?? [];
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
    const generation = this.documents.get(key)?.diagnosticGeneration ?? 0;
    const existing = this.diagnosticsMap.get(key);
    if (existing && existing.generation === generation) return existing.diagnostics;

    return new Promise<LspDiagnostic[]>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.diagnosticsWaiters.get(key) ?? [];
        this.diagnosticsWaiters.set(key, waiters.filter((waiter) => waiter.timer !== timer));
        const current = this.diagnosticsMap.get(key);
        resolve(current?.generation === generation ? current.diagnostics : []);
      }, waitMs);
      const waiters = this.diagnosticsWaiters.get(key) ?? [];
      waiters.push({ generation, resolve, timer });
      this.diagnosticsWaiters.set(key, waiters);
    });
  }

  // ─── Internal ───────────────────────────────────────────────

  private handleDiagnostics(params: PublishDiagnosticsParams) {
    const key = normalizeUri(params.uri);
    const document = this.documents.get(key);
    if (params.version !== undefined && document && params.version < document.version) return;

    const generation = document?.diagnosticGeneration ?? this.diagnosticsMap.get(key)?.generation ?? 0;
    this.diagnosticsMap.set(key, {
      diagnostics: params.diagnostics,
      version: params.version,
      generation,
    });

    const waiters = this.diagnosticsWaiters.get(key) ?? [];
    const pending: DiagnosticWaiter[] = [];
    for (const waiter of waiters) {
      if (waiter.generation <= generation) {
        clearTimeout(waiter.timer);
        waiter.resolve(params.diagnostics);
      } else {
        pending.push(waiter);
      }
    }
    if (pending.length > 0) this.diagnosticsWaiters.set(key, pending);
    else this.diagnosticsWaiters.delete(key);
  }

  private log(msg: string) {
    if (this.opts.verbose) process.stderr.write(`[slsp] ${msg}\n`);
  }
}

function getDocumentSyncPlan(capabilities: Record<string, unknown> | null): DocumentSyncPlan {
  const sync = capabilities?.textDocumentSync;

  if (sync === 1 || sync === 2) {
    return { kind: "change", syncKind: sync };
  }

  if (sync && typeof sync === "object") {
    const options = sync as TextDocumentSyncOptions;
    if (options.openClose !== true) {
      return {
        kind: "unsupported",
        reason: "Language server does not allow open/close document synchronization",
      };
    }
    if (options.change === 1 || options.change === 2) {
      return { kind: "change", syncKind: options.change };
    }
    return { kind: "reopen" };
  }

  return {
    kind: "unsupported",
    reason: "Language server does not advertise text document synchronization",
  };
}

function documentEndPosition(text: string): LspRange["end"] {
  const lines = text.split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
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
