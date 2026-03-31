/**
 * JSON-RPC 2.0 over stdio with Content-Length framing.
 * This is the base transport used by LSP.
 *
 * Protocol: each message is preceded by HTTP-like headers:
 *   Content-Length: <byte-length>\r\n
 *   \r\n
 *   <JSON body>
 */

import { type ChildProcess } from "node:child_process";
import { type Readable, type Writable } from "node:stream";

// ─── Types ────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type NotificationHandler = (params: unknown) => void;

// ─── Connection ───────────────────────────────────────────────

export class JsonRpcConnection {
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler[]>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private headerMode = true;

  constructor(
    private reader: Readable,
    private writer: Writable,
    private defaultTimeout = 30_000
  ) {}

  /** Start listening for incoming messages. */
  listen(): void {
    this.reader.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    this.reader.on("end", () => {
      // Server closed stdout — reject all pending
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error("Connection closed"));
      }
      this.pending.clear();
    });
  }

  /** Send a request and wait for the response. */
  sendRequest(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    this.writeMessage(msg);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request '${method}' (id=${id}) timed out after ${timeout ?? this.defaultTimeout}ms`));
      }, timeout ?? this.defaultTimeout);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Send a notification (no response expected). */
  sendNotification(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.writeMessage(msg);
  }

  /** Register a handler for a notification method. */
  onNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
  }

  /** Dispose the connection. */
  dispose(): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
    }
    this.pending.clear();
  }

  // ─── Internal ────────────────────────────────────────────────

  private writeMessage(msg: unknown): void {
    const body = JSON.stringify(msg);
    const contentLength = Buffer.byteLength(body, "utf-8");
    const header = `Content-Length: ${contentLength}\r\n\r\n`;
    this.writer.write(header + body);
  }

  private processBuffer(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.headerMode) {
        // Look for the end of headers: \r\n\r\n
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return; // Need more data

        const headerStr = this.buffer.subarray(0, headerEnd).toString("utf-8");
        this.buffer = this.buffer.subarray(headerEnd + 4);

        // Parse Content-Length
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Skip malformed header, try again
          continue;
        }
        this.contentLength = parseInt(match[1], 10);
        this.headerMode = false;
      }

      if (!this.headerMode) {
        if (this.buffer.length < this.contentLength) return; // Need more data

        const body = this.buffer.subarray(0, this.contentLength).toString("utf-8");
        this.buffer = this.buffer.subarray(this.contentLength);
        this.contentLength = -1;
        this.headerMode = true;

        try {
          const msg = JSON.parse(body);
          this.handleMessage(msg);
        } catch {
          // Malformed JSON, skip
        }
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    // Response to a request
    if ("id" in msg && msg.id !== null && msg.id !== undefined) {
      const resp = msg as JsonRpcResponse;
      const id = resp.id as string | number;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (resp.error) {
          pending.reject(
            new Error(`LSP error [${resp.error.code}]: ${resp.error.message}`)
          );
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Notification
    if ("method" in msg) {
      const notif = msg as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notif.method);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(notif.params);
          } catch {
            // Swallow handler errors
          }
        }
      }
    }
  }
}
