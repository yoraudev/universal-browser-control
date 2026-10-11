import { WebSocket } from "ws";
import { CLIENT_PATH, TOKEN_HEADER, type CallOptions, type Params, type RequestMessage, type ResponseMessage } from "@ubc/shared/protocol";
import { DEFAULT_TIMEOUT_MS, type Backend } from "./hub";

export class Relay implements Backend {
  readonly kind = "relay";
  onClose?: () => void;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;

  private constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ResponseMessage;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error !== undefined) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    });
    ws.on("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Connection to the hub process was lost; retry the call"));
      }
      this.pending.clear();
      this.onClose?.();
    });
    ws.on("error", () => {});
  }

  static connect(port: number, token: string): Promise<Relay> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${CLIENT_PATH}`, {
        headers: { [TOKEN_HEADER]: token },
        maxPayload: 256 * 1024 * 1024,
      });
      ws.once("open", () => {
        ws.off("error", reject);
        resolve(new Relay(ws));
      });
      ws.once("error", reject);
    });
  }

  call(method: string, params: Params, options: CallOptions = {}): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs + 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "request", id, method, params, ...options, timeoutMs } satisfies RequestMessage));
    });
  }

  close(): void {
    this.onClose = undefined;
    this.ws.terminate();
  }
}
