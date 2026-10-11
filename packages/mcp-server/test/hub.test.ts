import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CLIENT_PATH, EXTENSION_PATH, TOKEN_HEADER } from "@ubc/shared/protocol";
import { Bridge } from "../src/bridge";
import { toContent } from "../src/mcp";

let port = 19300 + Math.floor(Math.random() * 500);
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeBridge(home: string, p: number): Bridge {
  const bridge = new Bridge({ port: p, home, browserWaitMs: 300 });
  cleanups.push(() => bridge.close());
  return bridge;
}

function fakeExtension(p: number, id = "b1", name = "Chrome"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${p}${EXTENSION_PATH}`, { origin: "chrome-extension://abcdefgh" });
    cleanups.push(() => ws.terminate());
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", info: { id, name, version: "1", extensionVersion: "0.1.0" } }));
      setTimeout(() => resolve(ws), 50);
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "request") return;
      if (msg.method === "fail") ws.send(JSON.stringify({ type: "response", id: msg.id, error: "boom" }));
      else if (msg.method !== "hang") ws.send(JSON.stringify({ type: "response", id: msg.id, result: { via: id, method: msg.method, params: msg.params, client: msg.client } }));
    });
  });
}

function handshakeStatus(url: string, options: object): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.on("open", () => (ws.terminate(), resolve("open")));
    ws.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
    ws.on("error", () => resolve("error"));
  });
}

describe("hub", () => {
  it("routes requests to the extension and returns results and errors", async () => {
    const p = port++;
    const bridge = makeBridge(mkdtempSync(join(tmpdir(), "ubc-")), p);
    await bridge.ensure();
    expect(bridge.kind).toBe("hub");
    await fakeExtension(p);
    expect(await bridge.call("tabs_list", { a: 1 })).toEqual({ via: "b1", method: "tabs_list", params: { a: 1 } });
    await expect(bridge.call("fail", {})).rejects.toThrow("boom");
    await expect(bridge.call("hang", {}, { timeoutMs: 100 })).rejects.toThrow("timed out");
    expect(await bridge.call("browser_list", {})).toEqual([{ id: "b1", name: "Chrome", version: "1", extensionVersion: "0.1.0" }]);
  });

  it("explains when no browser is connected, and requires a choice between several", async () => {
    const p = port++;
    const bridge = makeBridge(mkdtempSync(join(tmpdir(), "ubc-")), p);
    await expect(bridge.call("tabs_list", {})).rejects.toThrow("No browser is connected");
    await fakeExtension(p, "b1", "Chrome");
    await fakeExtension(p, "b2", "Microsoft Edge");
    await expect(bridge.call("tabs_list", {})).rejects.toThrow("Several browsers");
    expect(await bridge.call("tabs_list", {}, { browser: "edge" })).toMatchObject({ via: "b2" });
    expect(await bridge.call("tabs_list", {}, { browser: "b1" })).toMatchObject({ via: "b1" });
    await expect(bridge.call("tabs_list", {}, { browser: "firefox" })).rejects.toThrow("No browser matches");
  });

  it("rejects web page origins and clients without the token", async () => {
    const p = port++;
    await makeBridge(mkdtempSync(join(tmpdir(), "ubc-")), p).ensure();
    const base = `ws://127.0.0.1:${p}`;
    expect(await handshakeStatus(base + EXTENSION_PATH, { origin: "https://evil.example" })).toBe("403");
    expect(await handshakeStatus(base + EXTENSION_PATH, {})).toBe("403");
    expect(await handshakeStatus(base + CLIENT_PATH, {})).toBe("403");
    expect(await handshakeStatus(base + CLIENT_PATH, { headers: { [TOKEN_HEADER]: "wrong" } })).toBe("403");
    expect(await handshakeStatus(base + EXTENSION_PATH, { origin: "chrome-extension://abc" })).toBe("open");
  });

  it("relays through the process that owns the port, and takes over when it exits", async () => {
    const p = port++;
    const home = mkdtempSync(join(tmpdir(), "ubc-"));
    const first = makeBridge(home, p);
    const second = makeBridge(home, p);
    await first.ensure();
    await second.ensure();
    expect([first.kind, second.kind]).toEqual(["hub", "relay"]);
    await fakeExtension(p);
    expect(await second.call("tabs_list", {}, { client: "claude-code" })).toMatchObject({ via: "b1", client: "claude-code" });
    await expect(second.call("fail", {})).rejects.toThrow("boom");

    first.close();
    await new Promise((r) => setTimeout(r, 1000));
    expect(second.kind).toBe("hub");
    await fakeExtension(p, "b9");
    expect(await second.call("tabs_list", {})).toMatchObject({ via: "b9" });
  });

  it("tells the extension which clients are present", async () => {
    const p = port++;
    const home = mkdtempSync(join(tmpdir(), "ubc-"));
    const first = makeBridge(home, p);
    const second = makeBridge(home, p);
    await first.ensure();
    const announced: string[][] = [];
    const extension = new WebSocket(`ws://127.0.0.1:${p}${EXTENSION_PATH}`, { origin: "chrome-extension://abcdefgh" });
    cleanups.push(() => extension.terminate());
    extension.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "clients") announced.push(msg.ids);
    });
    await new Promise((resolve) => extension.on("open", resolve));
    extension.send(JSON.stringify({ type: "hello", info: { id: "b1", name: "Chrome", version: "1", extensionVersion: "0.1.0" } }));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
    await settle();
    await second.ensure();
    await settle();
    second.close();
    await settle();
    expect(announced.map((ids) => ids.length)).toEqual([1, 2, 1]);
    expect(announced[1][0]).toBe(announced[0][0]);
    expect(announced[2]).toEqual(announced[0]);
  });
});

describe("toContent", () => {
  it("renders plain and rich results", () => {
    expect(toContent("hi", {})).toEqual([{ type: "text", text: "hi" }]);
    expect(toContent({ a: 1 }, {})[0]).toMatchObject({ type: "text" });
    const rich = toContent({ $rich: true, text: { ok: 1 }, images: [{ data: "AAAA", mimeType: "image/png" }] }, {});
    expect(rich.map((c) => c.type)).toEqual(["text", "image"]);
  });
});
