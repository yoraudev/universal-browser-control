import { CLIENT_PARAM, type Params } from "@ubc/shared/protocol";
import { attach, getState, send, type TabState } from "../cdp";
import { controllerLabel, showIndicator } from "../indicator";
import { sleep } from "../input";

export type Handler = (params: Params) => Promise<unknown>;

export async function targetTabId(params: Params): Promise<number> {
  if (typeof params.tab_id === "number") return params.tab_id;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = focused ?? (await chrome.tabs.query({ active: true }))[0];
  if (tab?.id === undefined) throw new Error("No active tab found; pass tab_id (see tabs_list).");
  return tab.id;
}

export async function page(params: Params, options: { allowDialog?: boolean } = {}): Promise<TabState> {
  const state = await attach(await targetTabId(params));
  const controller = controllerLabel(params[CLIENT_PARAM]);
  if (state.controller !== controller) {
    state.controller = controller;
    void showIndicator(state.tabId, controller);
  }
  if (state.dialog && !options.allowDialog) {
    throw new Error(`A JavaScript ${state.dialog.type} dialog is open ("${state.dialog.message}"). Call handle_dialog first.`);
  }
  return state;
}

export function tabInfo(tab: chrome.tabs.Tab) {
  return {
    id: tab.id,
    window_id: tab.windowId,
    index: tab.index,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    status: tab.status,
    pinned: tab.pinned || undefined,
    audible: tab.audible || undefined,
    muted: tab.mutedInfo?.muted || undefined,
    incognito: tab.incognito || undefined,
    group_id: tab.groupId !== undefined && tab.groupId !== -1 ? tab.groupId : undefined,
    debugger_attached: (tab.id !== undefined && !!getState(tab.id)) || undefined,
  };
}

export async function waitForLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  await sleep(100);
  return new Promise((resolve) => {
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(loaded);
    };
    const onUpdated = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      (tab) => tab.status === "complete" && finish(true),
      () => finish(false),
    );
  });
}

export async function evaluate<T = any>(state: TabState, expression: string, sessionId?: string): Promise<T> {
  const { result, exceptionDetails } = await send(
    state.tabId,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
  return result.value as T;
}

export function paginate(text: string, params: Params) {
  const offset: number = params.offset ?? 0;
  const max: number = params.max_chars ?? 30000;
  const slice = text.slice(offset, offset + max);
  const remaining = text.length - offset - slice.length;
  return { text: slice, total_chars: text.length, remaining_chars: remaining, next_offset: remaining > 0 ? offset + slice.length : undefined };
}

export function paginateText(text: string, params: Params): string {
  const { text: slice, remaining_chars, next_offset } = paginate(text, params);
  return remaining_chars > 0 ? `${slice}\n… [${remaining_chars} more characters; call again with offset=${next_offset}]` : slice;
}

async function tabStatus(state: TabState, newTabs: chrome.tabs.Tab[]) {
  const tab = await chrome.tabs.get(state.tabId).catch(() => undefined);
  return {
    tab_id: state.tabId,
    url: tab?.url,
    title: tab?.title,
    dialog: state.dialog ?? undefined,
    new_tabs: newTabs.length ? newTabs.map((t) => ({ id: t.id, url: t.pendingUrl ?? t.url })) : undefined,
    closed: tab ? undefined : true,
  };
}

export async function act<T extends object>(state: TabState, action: () => Promise<T | void>): Promise<object> {
  const newTabs: chrome.tabs.Tab[] = [];
  const onCreated = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === state.tabId) newTabs.push(tab);
  };
  chrome.tabs.onCreated.addListener(onCreated);
  let wake!: () => void;
  const dialogOpened = new Promise<void>((resolve) => (wake = resolve));
  state.dialogWaiters.add(wake);
  try {
    const running = action();
    running.catch(() => {});
    const result = await Promise.race([running, dialogOpened]);
    await sleep(150);
    return { ...(result ?? {}), ...(await tabStatus(state, newTabs)) };
  } finally {
    state.dialogWaiters.delete(wake);
    chrome.tabs.onCreated.removeListener(onCreated);
  }
}
