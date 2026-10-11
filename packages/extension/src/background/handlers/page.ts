import type { RichResult } from "@ubc/shared/protocol";
import { send, type TabState } from "../cdp";
import { INDICATOR_SELECTOR } from "../indicator";
import { callOnNode, nodeBox, resolveNode } from "../input";
import { isFrameNode, renderSnapshot, type AXNode, type FrameTree } from "../snapshot";
import { evaluate, page, paginate, paginateText, type Handler } from "./common";

const MAX_IMAGE_HEIGHT = 16000;

function frameIds(tree: any): string[] {
  return [tree.frame.id, ...(tree.childFrames ?? []).flatMap(frameIds)];
}

async function collectFrames(state: TabState): Promise<{ frames: Map<string, FrameTree>; rootFrameId: string }> {
  const frames = new Map<string, FrameTree>();
  let rootFrameId = "";
  const sessions: (string | undefined)[] = [undefined, ...state.sessions.keys()];
  await Promise.all(
    sessions.map(async (sessionId) => {
      const refPrefix = sessionId ? `s${state.sessions.get(sessionId)!.index}` : "";
      const { frameTree } = await send(state.tabId, "Page.getFrameTree", {}, sessionId);
      if (!sessionId) rootFrameId = frameTree.frame.id;
      await Promise.all(
        frameIds(frameTree).map(async (frameId) => {
          const { nodes } = await send<{ nodes: AXNode[] }>(state.tabId, "Accessibility.getFullAXTree", { frameId }, sessionId).catch(() => ({
            nodes: [],
          }));
          const childFrames = new Map<number, string>();
          await Promise.all(
            nodes.filter(isFrameNode).map(async (node) => {
              const described = await send(state.tabId, "DOM.describeNode", { backendNodeId: node.backendDOMNodeId }, sessionId).catch(() => null);
              if (described?.node.frameId) childFrames.set(node.backendDOMNodeId!, described.node.frameId);
            }),
          );
          frames.set(frameId, { refPrefix, nodes, childFrames });
        }),
      );
    }),
  );
  return { frames, rootFrameId };
}

function readImageSize(base64: string, format: "png" | "jpeg"): { width: number; height: number } | undefined {
  const bytes = atob(base64.slice(0, 87380));
  const u16 = (i: number) => (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1);
  if (format === "png") return { width: (u16(16) << 16) | u16(18), height: (u16(20) << 16) | u16(22) };
  for (let i = 2; i + 9 < bytes.length && bytes.charCodeAt(i) === 0xff; i += 2 + u16(i + 2)) {
    const marker = bytes.charCodeAt(i + 1);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16(i + 7), height: u16(i + 5) };
  }
  return undefined;
}

async function resizeImage(base64: string, width: number, height: number, format: "png" | "jpeg", quality: number): Promise<string> {
  const source = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([source]), { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: `image/${format}`, quality: quality / 100 })).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const FIND_ELEMENTS = `(query, by, limit) => {
  let found = [];
  if (by === "css") found = [...document.querySelectorAll(query)];
  else if (by === "xpath") {
    const result = document.evaluate(query, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) found.push(result.snapshotItem(i));
  } else {
    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
      const attrs = ["aria-label", "placeholder", "title", "alt", "value", "name"].map((a) => el.getAttribute(a) || "").join(" ");
      if ((own + " " + attrs).toLowerCase().includes(needle)) found.push(el);
    }
  }
  return found.filter((n) => n && n.nodeType === 1).slice(0, limit);
}`;

const DESCRIBE_ELEMENT = `function () {
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  const attr = (name) => this.getAttribute(name) || undefined;
  return {
    tag: this.tagName.toLowerCase(),
    text: (this.innerText || this.value || "").replace(/\\s+/g, " ").trim().slice(0, 120) || undefined,
    id: this.id || undefined,
    name: attr("name"), type: attr("type"), role: attr("role"), aria_label: attr("aria-label"), href: attr("href"), placeholder: attr("placeholder"),
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
    x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
  };
}`;

export const pageHandlers: Record<string, Handler> = {
  async page_snapshot(p) {
    const state = await page(p);
    const [{ frames, rootFrameId }, tab] = await Promise.all([collectFrames(state), chrome.tabs.get(state.tabId)]);
    const outline = renderSnapshot(frames, rootFrameId, { interactiveOnly: p.interactive_only });
    return paginateText(`Tab ${state.tabId} — ${tab.title}\nURL: ${tab.url}\n\n${outline || "(empty page)"}`, p);
  },

  async page_text(p) {
    const state = await page(p);
    const result = await evaluate<{ url: string; title: string; text: string | null }>(
      state,
      `(() => { const el = ${p.selector ? `document.querySelector(${JSON.stringify(p.selector)})` : "document.body"};
        return { url: location.href, title: document.title, text: el ? el.innerText : null }; })()`,
    );
    if (result.text === null) throw new Error(`No element matches selector "${p.selector}"`);
    return { tab_id: state.tabId, url: result.url, title: result.title, ...paginate(result.text, p) };
  },

  async page_html(p) {
    const state = await page(p);
    const html =
      p.ref || p.selector
        ? await callOnNode<string>(state, await resolveNode(state, p), "function () { return this.outerHTML ?? this.textContent; }")
        : await evaluate<string>(state, "document.documentElement.outerHTML");
    return paginateText(html, p);
  },

  async page_screenshot(p) {
    const state = await page(p);
    const box = p.ref || p.selector ? await nodeBox(state, await resolveNode(state, p), p) : undefined;
    const m = await evaluate<{ w: number; h: number; sx: number; sy: number; dpr: number; fw: number; fh: number }>(
      state,
      `(() => { const d = document.documentElement, b = document.body;
        return { w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY, dpr: devicePixelRatio,
          fw: Math.max(d.scrollWidth, b ? b.scrollWidth : 0), fh: Math.max(d.scrollHeight, b ? b.scrollHeight : 0) }; })()`,
    );
    const region = box ? "element" : p.full_page ? "full_page" : "viewport";
    const clip = box
      ? { x: box.x + m.sx, y: box.y + m.sy, width: box.width, height: box.height }
      : p.full_page
        ? { x: 0, y: 0, width: m.fw, height: m.fh }
        : { x: m.sx, y: m.sy, width: m.w, height: m.h };
    const scale = Math.min(1, p.max_width / clip.width, MAX_IMAGE_HEIGHT / clip.height);
    const target = { width: Math.round(clip.width * scale), height: Math.round(clip.height * scale) };
    const resize = region === "viewport" && Math.round(m.w * m.dpr) !== target.width;
    const capture =
      region === "viewport"
        ? { format: resize ? "png" : p.format }
        : { format: p.format, clip: { ...clip, scale: scale / m.dpr }, captureBeyondViewport: true };
    const tab = await chrome.tabs.get(state.tabId);
    const setIndicator = (display: string) =>
      evaluate(state, `document.querySelector("${INDICATOR_SELECTOR}")?.style.setProperty("display", "${display}", "important")`).catch(() => {});
    await setIndicator("none");
    let data: string;
    try {
      ({ data } = await send(
        state.tabId,
        "Page.captureScreenshot",
        { ...capture, quality: capture.format === "jpeg" ? p.quality : undefined },
        undefined,
        tab.active ? 30_000 : 10_000,
      ));
    } catch (error) {
      if (!tab.active && /timed out/.test((error as Error).message)) {
        throw new Error("Screenshot timed out because the tab is in the background and not being rendered. Call tab_activate first.");
      }
      throw error;
    } finally {
      await setIndicator("block");
    }
    if (resize) data = await resizeImage(data, target.width, target.height, p.format, p.quality);
    const size = readImageSize(data, p.format);
    const cssPerPixel = size ? Math.round((clip.width / size.width) * 1000) / 1000 : undefined;
    const text = {
      tab_id: state.tabId,
      region,
      image_size: size ? `${size.width}x${size.height}` : undefined,
      css_size: `${Math.round(clip.width)}x${Math.round(clip.height)}`,
      css_pixels_per_image_pixel: cssPerPixel,
      note:
        region === "viewport"
          ? cssPerPixel === 1
            ? "Image coordinates equal viewport coordinates for click/hover/scroll."
            : `Multiply image coordinates by ${cssPerPixel} to get viewport coordinates for click/hover/scroll.`
          : "Not the viewport: do not use image coordinates for clicking; use refs.",
    };
    return { $rich: true, text, images: [{ data, mimeType: `image/${p.format}` }] } satisfies RichResult;
  },

  async page_find(p) {
    const state = await page(p);
    const { result, exceptionDetails } = await send(state.tabId, "Runtime.evaluate", {
      expression: `(${FIND_ELEMENTS})(${JSON.stringify(p.query)}, ${JSON.stringify(p.by)}, ${p.limit})`,
      objectGroup: "ubc-find",
    });
    if (exceptionDetails) throw new Error(`Invalid ${p.by} query: ${exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text}`);
    try {
      const { result: properties } = await send(state.tabId, "Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
      const elements = (properties as any[]).filter((prop) => /^\d+$/.test(prop.name) && prop.value?.objectId);
      return await Promise.all(
        elements.map(async (prop) => {
          const [{ node }, described] = await Promise.all([
            send(state.tabId, "DOM.describeNode", { objectId: prop.value.objectId }),
            send(state.tabId, "Runtime.callFunctionOn", { objectId: prop.value.objectId, functionDeclaration: DESCRIBE_ELEMENT, returnByValue: true }),
          ]);
          return { ref: `e${node.backendNodeId}`, ...described.result.value };
        }),
      );
    } finally {
      void send(state.tabId, "Runtime.releaseObjectGroup", { objectGroup: "ubc-find" }).catch(() => {});
    }
  },

  async page_pdf(p) {
    const state = await page(p);
    const { data } = await send(state.tabId, "Page.printToPDF", { landscape: p.landscape, printBackground: p.print_background }, undefined, 60_000);
    return { $rich: true, text: { tab_id: state.tabId }, file: { data, ext: "pdf" } } satisfies RichResult;
  },
};
