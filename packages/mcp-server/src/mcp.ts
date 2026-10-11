import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isRichResult, type Params } from "@ubc/shared/protocol";
import { TOOLS, type ToolDef } from "@ubc/shared/tools";
import type { Bridge } from "./bridge";
import { DEFAULT_TIMEOUT_MS } from "./hub";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

declare const __UBC_VERSION__: string | undefined;
const VERSION = typeof __UBC_VERSION__ === "string" ? __UBC_VERSION__ : "0.0.0-dev";

const INSTRUCTIONS =
  "These tools control the user's real browser. A tab you work on shows the user an indicator that it is being controlled. " +
  "When you have finished working with a tab, call release_tab for it before you give your final answer, so the indicator goes away. " +
  "If a tool reports that the user stopped control of a tab, leave that tab alone and tell the user.";

const browserParam = {
  browser: z.string().optional().describe("Browser id or name from browser_list. Only needed when several browsers are connected."),
};

function inputSchema(tool: ToolDef) {
  return tool.target === "extension" ? tool.input.extend(browserParam) : tool.input;
}

function saveFile(base64: string, path: string): string {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, Buffer.from(base64, "base64"));
  return full;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 1);
}

export function toContent(result: unknown, params: Params): Content[] {
  if (!isRichResult(result)) return [{ type: "text", text: toText(result ?? "OK") }];
  let text = result.text;
  const saved = result.file
    ? saveFile(result.file.data, params.save_path ?? join(tmpdir(), "universal-browser-control", `${Date.now()}.${result.file.ext}`))
    : params.save_path && result.images?.[0]
      ? saveFile(result.images[0].data, params.save_path)
      : undefined;
  if (saved) text = typeof text === "object" && text !== null ? { ...text, saved_to: saved } : `${text ?? ""}\nSaved to ${saved}`.trim();
  const content: Content[] = [];
  if (text !== undefined) content.push({ type: "text", text: toText(text) });
  for (const image of result.images ?? []) content.push({ type: "image", ...image });
  return content;
}

export function createMcpServer(bridge: Bridge): Server {
  const server = new Server({ name: "universal-browser-control", version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(inputSchema(tool), { io: "input" }) as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
    const tool = byName.get(request.params.name);
    if (!tool) return fail(`Unknown tool: ${request.params.name}`);
    const parsed = inputSchema(tool).safeParse(request.params.arguments ?? {});
    if (!parsed.success) return fail(`Invalid arguments for ${tool.name}:\n${z.prettifyError(parsed.error)}`);
    const { browser, ...params } = parsed.data as Params;
    const timeoutMs = DEFAULT_TIMEOUT_MS + (params.timeout_ms ?? 0) + (params.time_ms ?? 0);
    try {
      const client = server.getClientVersion()?.name;
      return { content: toContent(await bridge.call(tool.name, params, { browser, timeoutMs, client }), params) };
    } catch (error) {
      return fail((error as Error).message);
    }
  });

  return server;
}
