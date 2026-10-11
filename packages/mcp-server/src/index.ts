#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_PORT } from "@ubc/shared/protocol";
import { Bridge } from "./bridge";
import { createMcpServer } from "./mcp";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const log = (message: string) => process.stderr.write(`[universal-browser-control] ${message}\n`);

async function main() {
  const port = Number(argValue("--port") ?? process.env.UBC_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);

  const bridge = new Bridge({
    port,
    home: process.env.UBC_HOME,
    extensionIds: process.env.UBC_EXTENSION_IDS?.split(",").map((id) => id.trim()).filter(Boolean),
    log,
  });
  bridge.ensure().catch((error) => log(error.message));

  const shutdown = () => {
    bridge.close();
    process.exit(0);
  };
  const transport = new StdioServerTransport();
  transport.onclose = shutdown;
  process.stdin.on("end", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await createMcpServer(bridge).connect(transport);
}

main().catch((error) => {
  log(error.message);
  process.exit(1);
});
