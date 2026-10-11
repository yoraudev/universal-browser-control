import { CLIENT_PARAM } from "@ubc/shared/protocol";
import { assertNotBlocked } from "../blocked";
import { getState } from "../cdp";
import { controllerLabel, groupOpenedTab } from "../indicator";
import { tabInfo, targetTabId, touch, waitForLoad, type Handler } from "./common";

function windowInfo(win: chrome.windows.Window) {
  return {
    id: win.id,
    focused: win.focused,
    state: win.state,
    type: win.type,
    incognito: win.incognito || undefined,
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
    tab_count: win.tabs?.length,
  };
}

async function loadedTab(tabId: number, timeoutMs: number) {
  const loaded = await waitForLoad(tabId, timeoutMs);
  return { ...tabInfo(await chrome.tabs.get(tabId)), load_timed_out: loaded ? undefined : true };
}

async function requireIncognitoAccess(): Promise<void> {
  if (await chrome.extension.isAllowedIncognitoAccess()) return;
  throw new Error(
    'The extension is not allowed in incognito/private windows. The user must enable "Allow in Incognito" for Universal Browser Control on the browser\'s extensions page.',
  );
}

async function openIncognitoTab(url: string | undefined, active: boolean): Promise<chrome.tabs.Tab> {
  await requireIncognitoAccess();
  const existing = (await chrome.windows.getAll({ windowTypes: ["normal"] })).find((win) => win.incognito);
  if (existing) return chrome.tabs.create({ url, active, windowId: existing.id });
  const created = await chrome.windows.create({ url, incognito: true, focused: active });
  const tab = created?.tabs?.[0];
  if (!tab) throw new Error("The browser did not open an incognito window; incognito mode may be disabled by policy.");
  return tab;
}

export const tabHandlers: Record<string, Handler> = {
  async tabs_list(p) {
    const tabs = await chrome.tabs.query(p.window_id === undefined ? {} : { windowId: p.window_id });
    return tabs.filter((tab) => !p.url_contains || tab.url?.includes(p.url_contains)).map(tabInfo);
  },

  async tab_open(p) {
    const tab = p.incognito
      ? await openIncognitoTab(p.url, p.active)
      : await chrome.tabs.create({ url: p.url, active: p.active, windowId: p.window_id });
    await groupOpenedTab(tab, controllerLabel(p[CLIENT_PARAM]));
    if (p.active && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return p.url ? loadedTab(tab.id!, 30_000) : tabInfo(await chrome.tabs.get(tab.id!));
  },

  async tab_close(p) {
    for (const tabId of p.tab_ids) await assertNotBlocked(tabId);
    await chrome.tabs.remove(p.tab_ids);
    return { closed: p.tab_ids };
  },

  async tab_activate(p) {
    await assertNotBlocked(p.tab_id);
    const tab = await chrome.tabs.update(p.tab_id, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return tabInfo(await chrome.tabs.get(p.tab_id));
  },

  async tab_navigate(p) {
    const tabId = await targetTabId(p);
    const state = getState(tabId);
    if (state) touch(state, p);
    if (p.url) await chrome.tabs.update(tabId, { url: p.url });
    else if (p.action === "back") await chrome.tabs.goBack(tabId);
    else if (p.action === "forward") await chrome.tabs.goForward(tabId);
    else if (p.action === "reload") await chrome.tabs.reload(tabId, { bypassCache: !!p.bypass_cache });
    else throw new Error("Provide url or action.");
    return loadedTab(tabId, p.timeout_ms);
  },

  async tab_update(p) {
    let tabId = await targetTabId(p);
    if (p.duplicate) tabId = (await chrome.tabs.duplicate(tabId))!.id!;
    if (p.pinned !== undefined || p.muted !== undefined) await chrome.tabs.update(tabId, { pinned: p.pinned, muted: p.muted });
    if (p.index !== undefined || p.window_id !== undefined) await chrome.tabs.move(tabId, { index: p.index ?? -1, windowId: p.window_id });
    return tabInfo(await chrome.tabs.get(tabId));
  },

  async tab_group(p) {
    if (!chrome.tabGroups) throw new Error("This browser does not support tab groups.");
    const describe = (g: chrome.tabGroups.TabGroup) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed, window_id: g.windowId });
    if (p.action === "list") return (await chrome.tabGroups.query({})).map(describe);
    for (const tabId of p.tab_ids ?? []) await assertNotBlocked(tabId);
    if (p.action === "ungroup") {
      if (!p.tab_ids?.length) throw new Error("ungroup needs tab_ids.");
      await chrome.tabs.ungroup(p.tab_ids);
      return { ungrouped: p.tab_ids };
    }
    let groupId: number | undefined = p.group_id;
    if (p.action === "group") {
      if (!p.tab_ids?.length) throw new Error("group needs tab_ids.");
      groupId = await chrome.tabs.group({ tabIds: p.tab_ids, groupId });
    }
    if (groupId === undefined) throw new Error("update needs group_id.");
    const changes = { title: p.title, color: p.color, collapsed: p.collapsed };
    const hasChanges = Object.values(changes).some((value) => value !== undefined);
    return describe(hasChanges ? (await chrome.tabGroups.update(groupId, changes))! : await chrome.tabGroups.get(groupId));
  },

  async windows_list() {
    return (await chrome.windows.getAll({ populate: true })).map(windowInfo);
  },

  async window_create(p) {
    if (p.incognito) await requireIncognitoAccess();
    const win = await chrome.windows.create({
      url: p.url,
      incognito: p.incognito,
      type: p.type,
      width: p.width,
      height: p.height,
      left: p.left,
      top: p.top,
    });
    if (!win) throw new Error("The browser did not create the window.");
    for (const tab of win.tabs ?? []) await groupOpenedTab(tab, controllerLabel(p[CLIENT_PARAM]));
    return { ...windowInfo(win), tabs: (await chrome.tabs.query({ windowId: win.id })).map(tabInfo) };
  },

  async window_update(p) {
    const windowId = p.window_id ?? (await chrome.windows.getLastFocused()).id!;
    const bounds = { width: p.width, height: p.height, left: p.left, top: p.top };
    const hasBounds = Object.values(bounds).some((value) => value !== undefined);
    if (hasBounds) {
      await chrome.windows.update(windowId, { state: "normal" });
      await chrome.windows.update(windowId, bounds);
    }
    if (p.state && !(hasBounds && p.state === "normal")) await chrome.windows.update(windowId, { state: p.state });
    if (p.focused !== undefined) await chrome.windows.update(windowId, { focused: p.focused });
    return windowInfo(await chrome.windows.get(windowId));
  },

  async window_close(p) {
    await chrome.windows.remove(p.window_id);
    return { closed: p.window_id };
  },
};
