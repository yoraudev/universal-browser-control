import { hideIndicator, showIndicator } from "./indicator";
import { recordEvent, type ConsoleEntry, type NetEntry } from "./recorders";

export interface SessionInfo {
  index: number;
  targetId: string;
  parent?: string;
}

export interface DialogInfo {
  type: string;
  message: string;
  default_prompt?: string;
}

export interface TabState {
  tabId: number;
  controller?: string;
  ready: Promise<void>;
  sessions: Map<string, SessionInfo>;
  nextSessionIndex: number;
  dialog: DialogInfo | null;
  dialogWaiters: Set<() => void>;
  console: ConsoleEntry[];
  network: Map<string, NetEntry>;
  inflight: Set<string>;
  lastNetworkActivity: number;
  subscriptions: Set<string>;
  events: { ts: number; method: string; params: unknown; frame?: string }[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_EVENTS = 500;
const states = new Map<number, TabState>();

export const getState = (tabId: number) => states.get(tabId);
export const attachedTabs = () => [...states.keys()];

function cdpError(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error);
  try {
    message = JSON.parse(message).message ?? message;
  } catch {}
  return new Error(message);
}

export async function send<T = any>(
  tabId: number,
  method: string,
  params?: object,
  sessionId?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const target = (sessionId ? { tabId, sessionId } : { tabId }) as chrome.debugger.Debuggee;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const dialog = states.get(tabId)?.dialog ? " A JavaScript dialog is open: use handle_dialog." : "";
      reject(new Error(`${method} timed out after ${timeoutMs}ms.${dialog}`));
    }, timeoutMs);
  });
  try {
    return (await Promise.race([chrome.debugger.sendCommand(target, method, params as { [key: string]: unknown }), timeout])) as T;
  } catch (error) {
    throw cdpError(error);
  } finally {
    clearTimeout(timer!);
  }
}

async function initSession(tabId: number, sessionId?: string): Promise<void> {
  const quiet = (method: string, params?: object) => send(tabId, method, params, sessionId).catch(() => {});
  await Promise.all([
    quiet("Page.enable"),
    quiet("Runtime.enable"),
    quiet("Network.enable"),
    quiet("Log.enable"),
    quiet("DOM.enable"),
    quiet("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }),
  ]);
}

export async function attach(tabId: number): Promise<TabState> {
  const existing = states.get(tabId);
  if (existing) {
    await existing.ready;
    return existing;
  }
  const state: TabState = {
    tabId,
    ready: Promise.resolve(),
    sessions: new Map(),
    nextSessionIndex: 1,
    dialog: null,
    dialogWaiters: new Set(),
    console: [],
    network: new Map(),
    inflight: new Set(),
    lastNetworkActivity: 0,
    subscriptions: new Set(),
    events: [],
  };
  states.set(tabId, state);
  state.ready = (async () => {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (error) {
      const message = cdpError(error).message;
      if (!/already attached/i.test(message)) {
        throw new Error(
          `Cannot attach the debugger to tab ${tabId}: ${message}. Browser-internal pages (chrome://, the extension store, other extensions) cannot be controlled.`,
        );
      }
      await chrome.debugger.detach({ tabId }).catch(() => {});
      await chrome.debugger.attach({ tabId }, "1.3");
    }
    await initSession(tabId);
  })();
  try {
    await state.ready;
  } catch (error) {
    states.delete(tabId);
    throw error;
  }
  return state;
}

export async function detach(tabId: number): Promise<void> {
  states.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
  await hideIndicator(tabId);
}

export async function detachAll(): Promise<number[]> {
  const ids = attachedTabs();
  await Promise.all(ids.map(detach));
  return ids;
}

export function sessionByIndex(state: TabState, index: number): string {
  for (const [sessionId, info] of state.sessions) if (info.index === index) return sessionId;
  throw new Error(`Frame s${index} no longer exists; take a new page_snapshot.`);
}

export function sessionForFrame(state: TabState, frame?: string): string | undefined {
  if (!frame) return undefined;
  const match = /^s(\d+)$/.exec(frame);
  if (!match) throw new Error(`Invalid frame "${frame}"; expected something like "s2".`);
  return sessionByIndex(state, Number(match[1]));
}

function matchesSubscription(state: TabState, method: string): boolean {
  return state.subscriptions.has(method) || state.subscriptions.has(`${method.split(".")[0]}.*`) || state.subscriptions.has("*");
}

chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const state = source.tabId === undefined ? undefined : states.get(source.tabId);
  if (!state) return;
  const sessionId = (source as { sessionId?: string }).sessionId;

  if (method === "Target.attachedToTarget") {
    if (params.targetInfo.type === "iframe") {
      state.sessions.set(params.sessionId, {
        index: state.nextSessionIndex++,
        targetId: params.targetInfo.targetId,
        parent: sessionId,
      });
      void initSession(state.tabId, params.sessionId);
    }
  } else if (method === "Target.detachedFromTarget") {
    state.sessions.delete(params.sessionId);
  } else if (method === "Page.javascriptDialogOpening") {
    state.dialog = { type: params.type, message: params.message, default_prompt: params.defaultPrompt || undefined };
    for (const wake of state.dialogWaiters) wake();
    state.dialogWaiters.clear();
  } else if (method === "Page.javascriptDialogClosed") {
    state.dialog = null;
  }

  recordEvent(state, sessionId, method, params);

  if (state.subscriptions.size && matchesSubscription(state, method)) {
    const index = sessionId ? state.sessions.get(sessionId)?.index : undefined;
    state.events.push({ ts: Date.now(), method, params, frame: index ? `s${index}` : undefined });
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined || (source as { sessionId?: string }).sessionId) return;
  if (states.delete(source.tabId)) void hideIndicator(source.tabId);
});
chrome.webNavigation.onCommitted.addListener((details) => {
  const controller = details.frameId === 0 ? states.get(details.tabId)?.controller : undefined;
  if (controller) void showIndicator(details.tabId, controller);
});
chrome.tabs.onZoomChange.addListener(({ tabId }) => {
  const controller = states.get(tabId)?.controller;
  if (controller) void showIndicator(tabId, controller);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const controller = change.groupId === undefined ? undefined : states.get(tabId)?.controller;
  if (controller) void showIndicator(tabId, controller);
});
chrome.tabGroups?.onUpdated.addListener(async (group) => {
  for (const tab of await chrome.tabs.query({ groupId: group.id })) {
    const controller = tab.id === undefined ? undefined : states.get(tab.id)?.controller;
    if (controller) void showIndicator(tab.id!, controller);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => states.delete(tabId));
