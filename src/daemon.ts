/**
 * Daemon — a long-running background process that keeps LSP sessions alive.
 *
 * Architecture:
 *   CLI ──(Unix socket, newline-delimited JSON)──▶ Daemon ──(stdio)──▶ LSP Server
 *
 * Sessions are keyed by (serverName, rootPath) and lazily created.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LspClient } from "./lsp-client.js";
import { SERVER_REGISTRY, type ServerConfig } from "./servers.js";

// ─── Paths ────────────────────────────────────────────────────

function stateDir(): string {
  const dir = path.join(os.tmpdir(), "simple-lsp-cli");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSocketPath(): string {
  if (process.platform === "win32") {
    // Windows: use TCP port file instead of socket
    return path.join(stateDir(), `daemon-port.txt`);
  }
  return path.join(stateDir(), `daemon-${process.getuid?.() ?? 0}.sock`);
}

export function getPidFile(): string {
  return path.join(stateDir(), `daemon-${process.getuid?.() ?? 0}.pid`);
}

// ─── Daemon request/response ──────────────────────────────────

export interface DaemonRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface DaemonResponse {
  id: string;
  result?: unknown;
  error?: { message: string };
}

// ─── Session Pool ─────────────────────────────────────────────

class SessionPool {
  private sessions = new Map<string, LspClient>();
  private starting = new Map<string, Promise<LspClient>>();

  private key(server: string, root: string) {
    return `${server}::${path.resolve(root)}`;
  }

  async get(serverName: string, rootPath: string, verbose: boolean): Promise<LspClient> {
    const k = this.key(serverName, rootPath);
    if (this.sessions.has(k)) return this.sessions.get(k)!;
    if (this.starting.has(k)) return this.starting.get(k)!;

    const cfg = SERVER_REGISTRY[serverName];
    if (!cfg) throw new Error(`Unknown server: ${serverName}`);

    const promise = this.create(k, cfg, rootPath, verbose);
    this.starting.set(k, promise);
    try {
      const client = await promise;
      this.sessions.set(k, client);
      return client;
    } finally {
      this.starting.delete(k);
    }
  }

  private async create(k: string, cfg: ServerConfig, root: string, verbose: boolean) {
    const client = new LspClient({ server: cfg, rootPath: path.resolve(root), verbose });
    await client.start();
    return client;
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values()).map((c) => c.stop().catch(() => {}))
    );
    this.sessions.clear();
  }

  list(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// ─── Daemon Server ────────────────────────────────────────────

export async function startDaemon(verbose = false, idleTimeoutMs = 15 * 60 * 1000): Promise<void> {
  const pidFile = getPidFile();
  const pool = new SessionPool();
  const isWindows = process.platform === "win32";
  let lastActivityTime = Date.now();
  let idleCheckTimer: NodeJS.Timeout;

  const resetIdleTimer = () => {
    lastActivityTime = Date.now();
    clearTimeout(idleCheckTimer);
    idleCheckTimer = setTimeout(async () => {
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs >= idleTimeoutMs) {
        if (verbose) process.stderr.write(`[daemon] Idle timeout (${idleTimeoutMs}ms), shutting down\n`);
        await pool.stopAll();
        server.close();
        try { fs.unlinkSync(getSocketPath()); } catch {}
        try { fs.unlinkSync(pidFile); } catch {}
        process.exit(0);
      }
    }, idleTimeoutMs);
  };

  resetIdleTimer();

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        // Parse to check method before resetting idle timer
        let parsed: DaemonRequest | null = null;
        try { parsed = JSON.parse(line.trim()); } catch {}
        if (parsed && parsed.method !== "ping") {
          resetIdleTimer();
        }
        handleOne(pool, line.trim(), verbose, () => Date.now() - lastActivityTime).then(
          (resp) => socket.write(JSON.stringify(resp) + "\n"),
          (err) => socket.write(JSON.stringify({ id: "?", error: { message: String(err) } }) + "\n")
        );
      }
    });
  });

  if (isWindows) {
    // Windows: use TCP on localhost with random port
    const portFile = getSocketPath();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      fs.writeFileSync(portFile, String(addr.port));
      fs.writeFileSync(pidFile, String(process.pid));
      if (verbose) process.stderr.write(`[daemon] pid=${process.pid} port=${addr.port}\n`);
    });
  } else {
    // Unix: use domain socket
    const sockPath = getSocketPath();
    if (fs.existsSync(sockPath)) {
      try { fs.unlinkSync(sockPath); } catch { /* ok */ }
    }
    server.listen(sockPath, () => {
      fs.writeFileSync(pidFile, String(process.pid));
      if (verbose) process.stderr.write(`[daemon] pid=${process.pid} sock=${sockPath}\n`);
    });
  }

  const cleanup = async () => {
    await pool.stopAll();
    server.close();
    if (process.platform !== "win32") {
      const sockPath = getSocketPath();
      try { fs.unlinkSync(sockPath); } catch {}
    } else {
      try { fs.unlinkSync(getSocketPath()); } catch {}
    }
    try { fs.unlinkSync(pidFile); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function handleOne(
  pool: SessionPool,
  raw: string,
  verbose: boolean,
  getIdleMs: () => number
): Promise<DaemonResponse> {
  let req: DaemonRequest;
  try { req = JSON.parse(raw); } catch { return { id: "?", error: { message: "Bad JSON" } }; }

  try {
    const { method, params } = req;

    if (method === "ping") {
      return { id: req.id, result: { status: "ok", sessions: pool.list(), idleMs: getIdleMs() } };
    }
    if (method === "shutdown") {
      setTimeout(async () => {
        await pool.stopAll();
        // Clean up state files
        try { fs.unlinkSync(getSocketPath()); } catch {}
        try { fs.unlinkSync(getPidFile()); } catch {}
        process.exit(0);
      }, 100);
      return { id: req.id, result: { status: "shutting_down" } };
    }

    const serverName = params.server as string;
    const rootPath = params.root as string;
    if (!serverName || !rootPath) {
      return { id: req.id, error: { message: "Missing 'server' or 'root'" } };
    }

    const client = await pool.get(serverName, rootPath, verbose);
    const file = params.file as string;
    const line = (params.line as number) ?? 0;
    const col = (params.character as number) ?? 0;

    let result: unknown;
    switch (method) {
      case "hover":          result = await client.hover(file, line, col); break;
      case "definition":     result = await client.definition(file, line, col); break;
      case "typeDefinition": result = await client.typeDefinition(file, line, col); break;
      case "references":     result = await client.references(file, line, col); break;
      case "completion":     result = await client.completion(file, line, col); break;
      case "signatureHelp":  result = await client.signatureHelp(file, line, col); break;
      case "symbols":        result = await client.documentSymbols(file); break;
      case "diagnostics":    result = await client.diagnostics(file, (params.wait as number) ?? 5000); break;
      case "format":         result = await client.formatting(file); break;
      case "rename":         result = await client.rename(file, line, col, params.newName as string); break;
      case "codeActions":
        result = await client.codeActions(
          file, line, col,
          (params.endLine as number) ?? line,
          (params.endCol as number) ?? col
        );
        break;
      default:
        return { id: req.id, error: { message: `Unknown method: ${method}` } };
    }

    return { id: req.id, result };
  } catch (err) {
    return { id: req.id, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

// ─── Client helpers ───────────────────────────────────────────

export function isDaemonRunning(): boolean {
  const pf = getPidFile();
  if (!fs.existsSync(pf)) return false;
  const pid = parseInt(fs.readFileSync(pf, "utf-8").trim(), 10);
  try { process.kill(pid, 0); return true; } catch {
    // Process gone, clean up stale state files
    try { fs.unlinkSync(pf); } catch {}
    if (process.platform === "win32") {
      try { fs.unlinkSync(getSocketPath()); } catch {}
    }
    return false;
  }
}

export function sendToDaemon(req: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    let sock: net.Socket;

    if (process.platform === "win32") {
      // Windows: read port from file, connect via TCP
      const portFile = getSocketPath();
      if (!fs.existsSync(portFile)) {
        return reject(new Error("Daemon not running (no port file)"));
      }
      const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
      sock = net.createConnection(port, "127.0.0.1");
    } else {
      sock = net.createConnection(getSocketPath());
    }

    let buf = "";

    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (data) => {
      buf += data.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          clearTimeout(timer);
          resolve(parsed);
          sock.end();
          return;
        } catch {}
      }
    });
    sock.on("error", (err) => { clearTimeout(timer); reject(new Error(`Daemon connect failed: ${err.message}`)); });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("Daemon timeout")); }, 60_000);
  });
}
