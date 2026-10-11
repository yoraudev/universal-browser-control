import { CLIENT_ID_PARAM, CLIENT_PARAM } from "@ubc/shared/protocol";
import { blockedTabs, unblockAll } from "./blocked";
import { attachedTabs, detachAll, stopControl, whileRunning } from "./cdp";
import { connect, getSettings, isConnected, startConnection } from "./connection";
import type { Handler } from "./handlers/common";
import { dataHandlers } from "./handlers/data";
import { devtoolsHandlers } from "./handlers/devtools";
import { interactHandlers } from "./handlers/interact";
import { pageHandlers } from "./handlers/page";
import { tabHandlers } from "./handlers/tabs";

const handlers: Record<string, Handler> = { ...tabHandlers, ...pageHandlers, ...interactHandlers, ...devtoolsHandlers, ...dataHandlers };

startConnection((method, params, client, clientId) => {
  const handler = handlers[method];
  if (!handler) throw new Error(`The extension does not implement "${method}"; it may be older than the MCP server.`);
  return whileRunning(() => handler({ ...params, [CLIENT_PARAM]: client, [CLIENT_ID_PARAM]: clientId }));
});

const describeTabs = async (ids: number[]) =>
  (await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => undefined)))).filter((tab) => !!tab).map((tab) => ({ id: tab.id, title: tab.title }));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message.type === "stopControl" && sender.tab?.id !== undefined) await stopControl(sender.tab.id, { x: message.x, y: message.y });
    if (message.type === "unblockAll") await unblockAll();
    if (message.type === "detachAll") await detachAll();
    if (message.type === "connect") await connect();
    const settings = await getSettings();
    respond({
      connected: isConnected(),
      settings,
      attached: await describeTabs(attachedTabs()),
      blocked: await describeTabs(await blockedTabs()),
    });
  })();
  return true;
});
