import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CallOptions, Params } from "@ubc/shared/protocol";
import { Hub, type Backend } from "./hub";
import { Relay } from "./relay";

export interface BridgeOptions {
  port: number;
  home?: string;
  extensionIds?: string[];
  browserWaitMs?: number;
  log?: (message: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bridge {
  private backend?: Backend;
  private starting?: Promise<Backend>;
  private closed = false;
  private tokenFile: string;
  private clientId = randomUUID();

  constructor(private options: BridgeOptions) {
    const home = options.home ?? join(homedir(), ".universal-browser-control");
    mkdirSync(home, { recursive: true });
    this.tokenFile = join(home, "token");
  }

  get kind(): Backend["kind"] | undefined {
    return this.backend?.kind;
  }

  ensure(): Promise<Backend> {
    if (this.backend) return Promise.resolve(this.backend);
    return (this.starting ??= this.start().finally(() => (this.starting = undefined)));
  }

  async call(method: string, params: Params, options?: CallOptions): Promise<unknown> {
    return (await this.ensure()).call(method, params, { ...options, clientId: this.clientId });
  }

  close(): void {
    this.closed = true;
    this.backend?.close();
    this.backend = undefined;
  }

  private async start(): Promise<Backend> {
    const { port, log } = this.options;
    for (let attempt = 0; attempt < 20 && !this.closed; attempt++) {
      try {
        const hub = await Hub.start({ ...this.options, token: this.readOrCreateToken(), clientId: this.clientId });
        log?.(`listening for the browser extension on 127.0.0.1:${port}`);
        return (this.backend = hub);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
      try {
        const relay = await Relay.connect(port, this.readOrCreateToken(), this.clientId);
        relay.onClose = () => {
          this.backend = undefined;
          if (!this.closed) setTimeout(() => this.ensure().catch(() => {}), Math.random() * 300);
        };
        log?.(`port ${port} is owned by another instance; relaying through it`);
        return (this.backend = relay);
      } catch {
      }
      await sleep(200 + Math.random() * 200);
    }
    throw new Error(`Port ${port} is in use by another program. Set UBC_PORT (and the same port in the extension popup).`);
  }

  private readOrCreateToken(): string {
    try {
      const token = readFileSync(this.tokenFile, "utf8").trim();
      if (token) return token;
    } catch {}
    const token = randomBytes(32).toString("hex");
    try {
      writeFileSync(this.tokenFile, token, { mode: 0o600, flag: "wx" });
      return token;
    } catch {
      return readFileSync(this.tokenFile, "utf8").trim();
    }
  }
}
