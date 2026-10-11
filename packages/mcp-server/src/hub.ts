import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  CLIENT_PATH,
  EXTENSION_PATH,
  TOKEN_HEADER,
  type BrowserInfo,
  type CallOptions,
  type ClientToHub,
  type ExtensionToHub,
  type HubToExtension,
  type Params,
  type RequestMessage,
  type ResponseMessage,
} from "@ubc/shared/protocol";

export const DEFAULT_TIMEOUT_MS = 60_000;
const BROWSER_WAIT_MS = 8_000;
const MAX_PAYLOAD = 256 * 1024 * 1024;

export interface Backend {
  readonly kind: "hub" | "relay";
  call(method: string, params: Params, options?: CallOptions): Promise<unknown>;
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  browserId: string;
}

export interface HubOptions {
  port: number;
  token: string;
  clientId: string;
  extensionIds?: string[];
  browserWaitMs?: number;
}

export class Hub implements Backend {
  readonly kind = "hub";
  private server = http.createServer((_req, res) => res.writeHead(426).end());
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  private browsers = new Map<string, { ws: WebSocket; info: BrowserInfo }>();
  private pending = new Map<number, Pending>();
  private browserWaiters = new Set<() => void>();
  private relayClients = new Map<WebSocket, string>();
  private nextId = 1;

  private constructor(private options: HubOptions) {
    this.server.on("upgrade", (req, socket, head) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const origin = req.headers.origin;
      let accept: ((ws: WebSocket) => void) | undefined;
      if (path === EXTENSION_PATH && this.isAllowedExtension(origin)) accept = (ws) => this.onExtension(ws);
      else if (path === CLIENT_PATH && !origin && this.isValidToken(req.headers[TOKEN_HEADER])) accept = (ws) => this.onClient(ws);
      if (!accept) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, accept);
    });
  }

  static start(options: HubOptions): Promise<Hub> {
    return new Promise((resolve, reject) => {
      const hub = new Hub(options);
      hub.server.once("error", reject);
      hub.server.listen(options.port, "127.0.0.1", () => {
        hub.server.off("error", reject);
        resolve(hub);
      });
    });
  }

  listBrowsers(): BrowserInfo[] {
    return [...this.browsers.values()].map((b) => b.info);
  }

  async call(method: string, params: Params, options: CallOptions = {}): Promise<unknown> {
    if (method === "browser_list") return this.listBrowsers();
    const { timeoutMs = DEFAULT_TIMEOUT_MS, client, clientId } = options;
    const target = await this.pickBrowser(options.browser);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, browserId: target.info.id });
      target.ws.send(JSON.stringify({ type: "request", id, method, params, client, clientId } satisfies RequestMessage));
    });
  }

  close(): void {
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.server.close();
    this.failPending(() => true, "Server is shutting down");
  }

  private isAllowedExtension(origin: string | undefined): boolean {
    if (!origin?.startsWith("chrome-extension://")) return false;
    const allowed = this.options.extensionIds;
    return !allowed?.length || allowed.includes(origin.slice("chrome-extension://".length));
  }

  private isValidToken(header: string | string[] | undefined): boolean {
    if (typeof header !== "string") return false;
    const given = Buffer.from(header);
    const expected = Buffer.from(this.options.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private onExtension(ws: WebSocket): void {
    let browserId: string | undefined;
    ws.on("message", (data) => {
      let msg: ExtensionToHub;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (msg.type === "hello") {
        browserId = msg.info.id;
        this.browsers.get(browserId)?.ws.terminate();
        this.browsers.set(browserId, { ws, info: msg.info });
        this.announceClients(ws);
        for (const wake of this.browserWaiters) wake();
      } else if (msg.type === "response") {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error !== undefined) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
      }
    });
    ws.on("close", () => {
      if (!browserId || this.browsers.get(browserId)?.ws !== ws) return;
      this.browsers.delete(browserId);
      this.failPending((p) => p.browserId === browserId, "Browser disconnected");
    });
    ws.on("error", () => {});
  }

  private onClient(ws: WebSocket): void {
    ws.on("message", (data) => {
      let parsed: ClientToHub;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (parsed.type === "hello") {
        this.relayClients.set(ws, parsed.clientId);
        this.announceClients();
        return;
      }
      if (parsed.type !== "request") return;
      const msg = parsed;
      const reply = (response: Omit<ResponseMessage, "type" | "id">) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "response", id: msg.id, ...response }));
      };
      this.call(msg.method, msg.params, { browser: msg.browser, timeoutMs: msg.timeoutMs, client: msg.client, clientId: msg.clientId }).then(
        (result) => reply({ result }),
        (error: Error) => reply({ error: error.message }),
      );
    });
    ws.on("close", () => {
      if (this.relayClients.delete(ws)) this.announceClients();
    });
    ws.on("error", () => {});
  }

  private announceClients(only?: WebSocket): void {
    const message = JSON.stringify({ type: "clients", ids: [this.options.clientId, ...this.relayClients.values()] } satisfies HubToExtension);
    for (const ws of only ? [only] : [...this.browsers.values()].map((b) => b.ws)) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }

  private failPending(match: (p: Pending) => boolean, reason: string): void {
    for (const [id, pending] of this.pending) {
      if (!match(pending)) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  }

  private async pickBrowser(selector?: string) {
    if (this.browsers.size === 0) await this.waitForBrowser();
    const all = [...this.browsers.values()];
    if (all.length === 0) {
      throw new Error(
        `No browser is connected. Install and enable the Universal Browser Control extension and make sure its port is ${this.options.port}. ` +
          "It reconnects on its own within about 30 seconds; clicking its toolbar icon connects immediately.",
      );
    }
    const describe = () => all.map((b) => `"${b.info.name}" (id ${b.info.id})`).join(", ");
    if (!selector) {
      if (all.length === 1) return all[0];
      throw new Error(`Several browsers are connected; pass \`browser\` to choose one: ${describe()}`);
    }
    const needle = selector.toLowerCase();
    const matches = all.filter((b) => b.info.id === selector || b.info.name.toLowerCase().includes(needle));
    if (matches.length === 1) return matches[0];
    throw new Error(`${matches.length ? "Several browsers match" : "No browser matches"} "${selector}". Connected: ${describe()}`);
  }

  private waitForBrowser(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.browserWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, this.options.browserWaitMs ?? BROWSER_WAIT_MS);
      this.browserWaiters.add(done);
    });
  }
}
