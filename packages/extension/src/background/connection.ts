import { DEFAULT_PORT, EXTENSION_PATH, type BrowserInfo, type ExtensionToHub, type HubToExtension, type Params } from "@ubc/shared/protocol";

type RequestHandler = (method: string, params: Params, client?: string) => Promise<unknown>;

export interface Settings {
  port: number;
  label: string;
  enabled: boolean;
  browserId: string;
}

const PING_INTERVAL_MS = 20_000;
const RECONNECT_ALARM = "ubc-reconnect";

let socket: WebSocket | undefined;
let connected = false;
let handler: RequestHandler;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;
let generation = 0;

export const isConnected = () => connected;

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["port", "label", "enabled", "browserId"]);
  let browserId = stored.browserId as string | undefined;
  if (!browserId) {
    browserId = crypto.randomUUID().slice(0, 8);
    await chrome.storage.local.set({ browserId });
  }
  return { port: (stored.port as number) ?? DEFAULT_PORT, label: (stored.label as string) ?? "", enabled: stored.enabled !== false, browserId };
}

async function browserInfo(settings: Settings): Promise<BrowserInfo> {
  const brands: { brand: string; version: string }[] = (navigator as any).userAgentData?.brands ?? [];
  const isBrave = !!(navigator as any).brave;
  const brand = brands.find((b) => !/chromium|not.?a.?brand/i.test(b.brand)) ?? brands.find((b) => /chromium/i.test(b.brand));
  const name = isBrave ? "Brave" : (brand?.brand ?? "Chromium");
  return {
    id: settings.browserId,
    name: settings.label ? `${name} – ${settings.label}` : name,
    version: brand?.version ?? "",
    extensionVersion: chrome.runtime.getManifest().version,
  };
}

function send(message: ExtensionToHub): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function disconnect(): void {
  clearInterval(pingTimer);
  clearTimeout(retryTimer);
  const old = socket;
  socket = undefined;
  connected = false;
  old?.close();
}

export async function connect(): Promise<void> {
  const startedAt = generation;
  const settings = await getSettings();
  if (startedAt !== generation) return;
  if (!settings.enabled) return disconnect();
  if (socket) return;

  const ws = new WebSocket(`ws://127.0.0.1:${settings.port}${EXTENSION_PATH}`);
  socket = ws;
  ws.onopen = async () => {
    connected = true;
    retryDelay = 1000;
    send({ type: "hello", info: await browserInfo(settings) });
    pingTimer = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS);
  };
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data as string) as HubToExtension;
    if (message.type !== "request") return;
    try {
      send({ type: "response", id: message.id, result: (await handler(message.method, message.params, message.client)) ?? null });
    } catch (error) {
      send({ type: "response", id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    disconnect();
    retryTimer = setTimeout(() => void connect(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  };
}

export async function reconnect(): Promise<void> {
  generation++;
  disconnect();
  retryDelay = 1000;
  await connect();
}

export function startConnection(onRequest: RequestHandler): void {
  handler = onRequest;
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void connect();
  });
  chrome.runtime.onStartup.addListener(() => void connect());
  chrome.runtime.onInstalled.addListener(() => void connect());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.port || changes.label || changes.enabled)) void reconnect();
  });
  void connect();
}
