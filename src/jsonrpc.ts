/**
 * JSON-RPC 2.0 over stdio — thin wrapper around vscode-jsonrpc.
 */

import { type Readable, type Writable } from "node:stream";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
  CancellationTokenSource,
} from "vscode-jsonrpc/node.js";

export class JsonRpcConnection {
  private conn: MessageConnection;

  constructor(
    reader: Readable,
    writer: Writable,
    private defaultTimeout = 30_000,
    private verbose = false,
  ) {
    this.conn = createMessageConnection(
      new StreamMessageReader(reader),
      new StreamMessageWriter(writer),
    );
  }

  listen(): void {
    this.conn.listen();
  }

  async sendRequest(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    const ms = timeout ?? this.defaultTimeout;
    const cts = new CancellationTokenSource();
    const timer = setTimeout(() => cts.cancel(), ms);

    try {
      const result = await this.conn.sendRequest(method, params, cts.token);
      return result;
    } catch (err) {
      if (cts.token.isCancellationRequested) {
        throw new Error(`Request '${method}' timed out after ${ms}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      cts.dispose();
    }
  }

  sendNotification(method: string, params?: unknown): void {
    this.conn.sendNotification(method, params);
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.conn.onNotification(method, handler);
  }

  onRequest(method: string, handler: (params: unknown) => unknown): void {
    this.conn.onRequest(method, handler);
  }

  dispose(): void {
    this.conn.dispose();
  }
}
