const INDICATOR_ATTRIBUTE = "data-ubc-indicator";
export const INDICATOR_SELECTOR = `[${INDICATOR_ATTRIBUTE}]`;
const DEFAULT_CONTROLLER = "an AI agent";
const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#202124";
const MIN_TEXT_CONTRAST = 3;

export const GROUP_PALETTE = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
} as const;
export type GroupColor = keyof typeof GROUP_PALETTE;
const DEFAULT_COLOR: GroupColor = "blue";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export const RANDOM_GROUP_COLORS = (Object.keys(GROUP_PALETTE) as GroupColor[]).filter(
  (color) => contrast(GROUP_PALETTE[color], LIGHT_TEXT) >= MIN_TEXT_CONTRAST,
);

export function indicatorColors(color: GroupColor = DEFAULT_COLOR): { background: string; text: string } {
  const background = GROUP_PALETTE[color] ?? GROUP_PALETTE[DEFAULT_COLOR];
  return { background, text: contrast(background, LIGHT_TEXT) >= MIN_TEXT_CONTRAST ? LIGHT_TEXT : DARK_TEXT };
}

export function controllerLabel(client?: string): string {
  const words = (client ?? "").replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : DEFAULT_CONTROLLER;
}

function mountIndicator(attribute: string, controller: string, zoom: number, background: string, text: string): void {
  const mount = () => {
    let host = document.querySelector(`[${attribute}]`) as (HTMLElement & { ubcLabel?: HTMLElement }) | null;
    if (!host) {
      host = document.createElement("div");
      host.setAttribute(attribute, "");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText =
        "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; " +
        "pointer-events: none !important; display: block !important; contain: strict !important;";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `
        <style>
          .frame { position: absolute; inset: 0; box-shadow: inset 0 0 0 3px var(--ubc-color), inset 0 0 18px 2px color-mix(in srgb, var(--ubc-color) 45%, transparent); animation: pulse 2.4s ease-in-out infinite; }
          .banner { position: absolute; top: 0; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
            padding: 5px 14px 6px; border-radius: 0 0 10px 10px; background: var(--ubc-color); color: var(--ubc-text); white-space: nowrap;
            font: 500 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
          .stop { all: unset; pointer-events: auto; cursor: pointer; padding: 0 9px; border-radius: 999px; font: inherit; font-weight: 600;
            border: 1px solid color-mix(in srgb, var(--ubc-text) 60%, transparent); }
          .stop:hover { background: var(--ubc-text); color: var(--ubc-color); }
          .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ubc-text); animation: pulse 1.2s ease-in-out infinite; }
          @keyframes pulse { 50% { opacity: 0.45; } }
          @media (prefers-reduced-motion: reduce) { .frame, .dot { animation: none; } }
        </style>
        <div class="frame"></div>
        <div class="banner"><span class="dot"></span><span class="label"></span><button class="stop" title="Stop the agent and block it from this tab">Stop</button></div>`;
      host.ubcLabel = root.querySelector(".label") as HTMLElement;
      const indicator = host;
      root.querySelector(".stop")!.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        const { clientX: x, clientY: y } = event as MouseEvent;
        try {
          void chrome.runtime.sendMessage({ type: "stopControl", x, y });
        } catch {
          indicator.remove();
        }
      });
      document.documentElement.append(host);
    }
    host.style.setProperty("zoom", String(1 / zoom), "important");
    host.style.setProperty("--ubc-color", background, "important");
    host.style.setProperty("--ubc-text", text, "important");
    if (host.ubcLabel) host.ubcLabel.textContent = `This tab is being controlled by ${controller}`;
  };
  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

function unmountIndicator(selector: string): void {
  document.querySelector(selector)?.remove();
}

async function groupColor(tabId: number): Promise<GroupColor | undefined> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!chrome.tabGroups || tab?.groupId === undefined || tab.groupId === -1) return undefined;
  return (await chrome.tabGroups.get(tab.groupId).catch(() => undefined))?.color as GroupColor | undefined;
}

export async function showIndicator(tabId: number, controller: string): Promise<void> {
  const [zoom, color] = await Promise.all([chrome.tabs.getZoom(tabId).catch(() => 1), groupColor(tabId)]);
  const { background, text } = indicatorColors(color);
  await chrome.scripting
    .executeScript({ target: { tabId }, injectImmediately: true, func: mountIndicator, args: [INDICATOR_ATTRIBUTE, controller, zoom, background, text] })
    .catch(() => {});
}

export async function hideIndicator(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: unmountIndicator, args: [INDICATOR_SELECTOR] }).catch(() => {});
}

export async function groupOpenedTab(tab: chrome.tabs.Tab, controller: string): Promise<void> {
  if (!chrome.tabGroups || tab.id === undefined) return;
  try {
    const [existing] = await chrome.tabGroups.query({ windowId: tab.windowId, title: controller });
    const groupId = await chrome.tabs.group(existing ? { tabIds: tab.id, groupId: existing.id } : { tabIds: tab.id, createProperties: { windowId: tab.windowId } });
    if (!existing) await chrome.tabGroups.update(groupId, { title: controller, color: RANDOM_GROUP_COLORS[Math.floor(Math.random() * RANDOM_GROUP_COLORS.length)] });
  } catch {
  }
}
