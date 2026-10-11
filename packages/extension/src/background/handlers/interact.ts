import { send } from "../cdp";
import { callOnNode, modifierMask, mouseClick, mouseMove, nodeBox, pressKey, resolveNode, resolvePoint, sleep, typeText } from "../input";
import { act, evaluate, page, type Handler } from "./common";

const PREPARE_FILL = `function (value) {
  this.focus?.();
  const tag = this.tagName;
  const type = (this.getAttribute("type") || "text").toLowerCase();
  const textual = tag === "TEXTAREA" || (tag === "INPUT" && ["text", "search", "url", "tel", "password", "email", "number"].includes(type));
  if (textual) { this.select(); return "typed"; }
  if (this.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return "typed";
  }
  if (tag === "INPUT" || tag === "SELECT") {
    const proto = tag === "INPUT" ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(this, value);
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    return "set";
  }
  throw new Error("Element <" + tag.toLowerCase() + "> cannot be filled; use click and type instead.");
}`;

const SELECT_OPTIONS = `function (values) {
  if (this.tagName !== "SELECT") throw new Error("Element is not a <select>; use click for custom dropdowns.");
  const options = [...this.options];
  const matches = (o) => values.includes(o.value) || values.includes(o.label) || values.includes(o.textContent.trim());
  const picked = options.filter(matches);
  if (!picked.length) throw new Error("No matching option. Available: " + options.map((o) => o.label).join(", "));
  if (this.multiple) for (const o of options) o.selected = picked.includes(o);
  else this.value = picked[0].value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return picked.map((o) => o.label);
}`;

export const interactHandlers: Record<string, Handler> = {
  async click(p) {
    const state = await page(p);
    const point = await resolvePoint(state, p);
    return act(state, () => mouseClick(state, point, p.button, p.click_count, modifierMask(p.modifiers)));
  },

  async hover(p) {
    const state = await page(p);
    const point = await resolvePoint(state, p);
    return act(state, () => mouseMove(state, point.x, point.y));
  },

  async type(p) {
    const state = await page(p);
    const point = p.ref || p.selector ? await resolvePoint(state, p) : undefined;
    return act(state, async () => {
      if (point) await mouseClick(state, point);
      await typeText(state, p.text, p.delay_ms);
      if (p.submit) await pressKey(state, "Enter");
    });
  },

  async fill(p) {
    const state = await page(p);
    const node = await resolveNode(state, p);
    return act(state, async () => {
      const mode = await callOnNode<"typed" | "set">(state, node, PREPARE_FILL, [p.value]);
      if (mode === "typed") {
        if (p.value === "") await pressKey(state, "Delete");
        else await send(state.tabId, "Input.insertText", { text: p.value });
      }
      if (p.submit) await pressKey(state, "Enter");
    });
  },

  async press_key(p) {
    const state = await page(p);
    return act(state, async () => {
      for (let i = 0; i < p.repeat; i++) await pressKey(state, p.key);
    });
  },

  async select_option(p) {
    const state = await page(p);
    const node = await resolveNode(state, p);
    return act(state, async () => ({ selected: await callOnNode<string[]>(state, node, SELECT_OPTIONS, [p.values]) }));
  },

  async scroll(p) {
    const state = await page(p);
    const hasElement = !!(p.ref || p.selector);
    if (hasElement && !p.delta_x && !p.delta_y) {
      await nodeBox(state, await resolveNode(state, p), p);
      return act(state, async () => ({ scrolled_into_view: true }));
    }
    const point =
      hasElement || p.x !== undefined
        ? await resolvePoint(state, p)
        : await evaluate<{ x: number; y: number }>(state, "({ x: innerWidth / 2, y: innerHeight / 2 })");
    return act(state, async () => {
      await send(state.tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: p.delta_x, deltaY: p.delta_y });
      await sleep(250);
      return evaluate(state, "({ scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY) })");
    });
  },

  async drag(p) {
    const state = await page(p);
    const from = await resolvePoint(state, { ref: p.from_ref, x: p.from_x, y: p.from_y });
    const to = await resolvePoint(state, { ref: p.to_ref, x: p.to_x, y: p.to_y });
    return act(state, async () => {
      await mouseMove(state, from.x, from.y);
      await send(state.tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", clickCount: 1 });
      for (let step = 1; step <= p.steps; step++) {
        const t = step / p.steps;
        await mouseMove(state, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 0, 1);
        await sleep(10);
      }
      await send(state.tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
    });
  },

  async upload_file(p) {
    const state = await page(p);
    const node = await resolveNode(state, p);
    return act(state, async () => {
      await send(state.tabId, "DOM.setFileInputFiles", { files: p.paths, backendNodeId: node.backendNodeId }, node.sessionId);
      return { files: p.paths };
    });
  },

  async handle_dialog(p) {
    const state = await page(p, { allowDialog: true });
    const dialog = state.dialog;
    try {
      await send(state.tabId, "Page.handleJavaScriptDialog", { accept: p.accept, promptText: p.prompt_text });
    } catch (error) {
      if (/no dialog/i.test((error as Error).message)) throw new Error("No JavaScript dialog is open in this tab.");
      throw error;
    }
    state.dialog = null;
    return { handled: dialog ?? true, accepted: p.accept };
  },

  async wait_for(p) {
    const hasCondition = [p.text, p.text_gone, p.selector, p.selector_gone, p.url_contains, p.network_idle].some((v) => v !== undefined && v !== false);
    if (p.time_ms) await sleep(p.time_ms);
    if (!hasCondition) return { waited_ms: p.time_ms ?? 0 };

    const state = await page(p);
    const check = `(() => {
      const text = document.body ? document.body.innerText : "";
      const p = ${JSON.stringify({ text: p.text, text_gone: p.text_gone, selector: p.selector, selector_gone: p.selector_gone, url_contains: p.url_contains })};
      const unmet = [];
      if (p.text !== undefined && !text.includes(p.text)) unmet.push("text");
      if (p.text_gone !== undefined && text.includes(p.text_gone)) unmet.push("text_gone");
      if (p.selector !== undefined && !document.querySelector(p.selector)) unmet.push("selector");
      if (p.selector_gone !== undefined && document.querySelector(p.selector_gone)) unmet.push("selector_gone");
      if (p.url_contains !== undefined && !location.href.includes(p.url_contains)) unmet.push("url_contains");
      return unmet;
    })()`;
    const started = Date.now();
    let unmet: string[] = [];
    while (Date.now() - started < p.timeout_ms) {
      unmet = await evaluate<string[]>(state, check).catch(() => ["page not ready"]);
      if (p.network_idle) {
        const loading = (await chrome.tabs.get(state.tabId)).status !== "complete";
        if (loading || state.inflight.size > 0 || Date.now() - state.lastNetworkActivity < 500) unmet.push("network_idle");
      }
      if (!unmet.length) return { waited_ms: Date.now() - started + (p.time_ms ?? 0) };
      await sleep(200);
    }
    throw new Error(`wait_for timed out after ${p.timeout_ms}ms; unmet: ${unmet.join(", ")}`);
  },
};
