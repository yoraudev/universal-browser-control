import { send, sessionByIndex, type TabState } from "./cdp";

export interface NodeHandle {
  sessionId?: string;
  backendNodeId: number;
}

export interface ElementTarget {
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIER_ALIASES: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Command: "Meta", Option: "Alt", Win: "Meta" };
const MODIFIER_KEYS: Record<string, { code: string; keyCode: number }> = {
  Alt: { code: "AltLeft", keyCode: 18 },
  Control: { code: "ControlLeft", keyCode: 17 },
  Meta: { code: "MetaLeft", keyCode: 91 },
  Shift: { code: "ShiftLeft", keyCode: 16 },
};

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDef> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Insert: { key: "Insert", code: "Insert", keyCode: 45 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
for (let i = 1; i <= 12; i++) NAMED_KEYS[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };
const KEY_ALIASES: Record<string, string> = { Esc: "Escape", Return: "Enter", Del: "Delete", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", " ": "Space" };

function keyDef(name: string): KeyDef {
  const named = NAMED_KEYS[KEY_ALIASES[name] ?? name];
  if (named) return named;
  if ([...name].length !== 1) throw new Error(`Unknown key "${name}". Use names like Enter, Escape, ArrowDown, F5, or a single character.`);
  if (/[a-z]/i.test(name)) return { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name };
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, code: "", keyCode: 0, text: name };
}

export function modifierMask(names: string[] = []): number {
  return names.reduce((mask, name) => mask | (MODIFIER_BITS[MODIFIER_ALIASES[name] ?? name] ?? 0), 0);
}

export function parseRef(state: TabState, ref: string): NodeHandle {
  const match = /^(?:s(\d+))?e(\d+)$/.exec(ref.trim());
  if (!match) throw new Error(`Invalid ref "${ref}". Refs look like "e42" and come from page_snapshot or page_find.`);
  return { sessionId: match[1] ? sessionByIndex(state, Number(match[1])) : undefined, backendNodeId: Number(match[2]) };
}

function staleRef(error: Error, target: ElementTarget): Error {
  return /no node|could not find node|does not belong to the document/i.test(error.message)
    ? new Error(`Element ${target.ref ?? target.selector} no longer exists; take a new page_snapshot.`)
    : error;
}

export async function resolveNode(state: TabState, target: ElementTarget): Promise<NodeHandle> {
  if (target.ref) return parseRef(state, target.ref);
  if (!target.selector) throw new Error("Provide a ref or a selector.");
  const { result, exceptionDetails } = await send(state.tabId, "Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(target.selector)})`,
    objectGroup: "ubc",
  });
  if (exceptionDetails) throw new Error(`Invalid selector "${target.selector}"`);
  if (!result.objectId) throw new Error(`No element matches selector "${target.selector}"`);
  const { node } = await send(state.tabId, "DOM.describeNode", { objectId: result.objectId });
  return { backendNodeId: node.backendNodeId };
}

export async function callOnNode<T = any>(state: TabState, handle: NodeHandle, fn: string, args: unknown[] = []): Promise<T> {
  const { object } = await send(state.tabId, "DOM.resolveNode", { backendNodeId: handle.backendNodeId, objectGroup: "ubc" }, handle.sessionId);
  const { result, exceptionDetails } = await send(
    state.tabId,
    "Runtime.callFunctionOn",
    { objectId: object.objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true, userGesture: true },
    handle.sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
  return result.value as T;
}

async function sessionOffset(state: TabState, sessionId?: string): Promise<{ x: number; y: number }> {
  if (!sessionId) return { x: 0, y: 0 };
  const info = state.sessions.get(sessionId);
  if (!info) throw new Error("Frame no longer exists; take a new page_snapshot.");
  const owner = await send(state.tabId, "DOM.getFrameOwner", { frameId: info.targetId }, info.parent);
  const { model } = await send(state.tabId, "DOM.getBoxModel", { backendNodeId: owner.backendNodeId }, info.parent);
  const parent = await sessionOffset(state, info.parent);
  return { x: parent.x + model.content[0], y: parent.y + model.content[1] };
}

function quadBox(quad: number[]) {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export async function nodeBox(state: TabState, handle: NodeHandle, target: ElementTarget = {}) {
  await send(state.tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId: handle.backendNodeId }, handle.sessionId).catch((error) => {
    if (staleRef(error, target) !== error) throw staleRef(error, target);
  });
  let box: ReturnType<typeof quadBox> | undefined;
  try {
    const { quads } = await send(state.tabId, "DOM.getContentQuads", { backendNodeId: handle.backendNodeId }, handle.sessionId);
    box = (quads as number[][]).map(quadBox).find((b) => b.width >= 1 && b.height >= 1);
  } catch (error) {
    throw staleRef(error as Error, target);
  }
  if (!box) throw new Error(`Element ${target.ref ?? target.selector ?? ""} is not visible (it has no size or is hidden).`);
  const offset = await sessionOffset(state, handle.sessionId);
  return { ...box, x: box.x + offset.x, y: box.y + offset.y };
}

export async function resolvePoint(state: TabState, target: ElementTarget): Promise<{ x: number; y: number }> {
  if (target.ref || target.selector) {
    const box = await nodeBox(state, await resolveNode(state, target), target);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  if (target.x === undefined || target.y === undefined) throw new Error("Provide a ref, a selector, or both x and y.");
  return { x: target.x, y: target.y };
}

export async function mouseMove(state: TabState, x: number, y: number, modifiers = 0, buttons = 0): Promise<void> {
  await send(state.tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers, buttons });
}

export async function mouseClick(
  state: TabState,
  { x, y }: { x: number; y: number },
  button: "left" | "right" | "middle" = "left",
  clickCount = 1,
  modifiers = 0,
): Promise<void> {
  await mouseMove(state, x, y, modifiers);
  for (let count = 1; count <= clickCount; count++) {
    await send(state.tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: count, modifiers });
    await send(state.tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: count, modifiers });
  }
}

export async function pressKey(state: TabState, combo: string): Promise<void> {
  const parts = combo === "+" ? ["+"] : combo.split("+").map((part) => part.trim() || "+");
  const main = keyDef(parts.pop()!);
  const mods = parts.map((name) => {
    const canonical = MODIFIER_ALIASES[name] ?? name;
    if (!MODIFIER_KEYS[canonical]) throw new Error(`Unknown modifier "${name}". Use Control, Shift, Alt or Meta.`);
    return canonical;
  });
  let mask = 0;
  const held: string[] = [];
  try {
    for (const mod of mods) {
      mask |= MODIFIER_BITS[mod];
      await send(state.tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: mod, ...keyEventCodes(MODIFIER_KEYS[mod]), modifiers: mask });
      held.push(mod);
    }
    const text = mask & ~MODIFIER_BITS.Shift ? undefined : mask & MODIFIER_BITS.Shift && main.text?.length === 1 ? main.text.toUpperCase() : main.text;
    const event = { key: text && text !== "\r" ? text : main.key, ...keyEventCodes(main), modifiers: mask };
    await send(state.tabId, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...event, text, unmodifiedText: text });
    await send(state.tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
  } finally {
    for (const mod of held.reverse()) {
      mask &= ~MODIFIER_BITS[mod];
      await send(state.tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: mod, ...keyEventCodes(MODIFIER_KEYS[mod]), modifiers: mask }).catch(() => {});
    }
  }
}

function keyEventCodes(def: { code: string; keyCode: number }) {
  return { code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
}

export async function typeText(state: TabState, text: string, delayMs = 0): Promise<void> {
  for (const char of text) {
    if (char === "\n") await pressKey(state, "Enter");
    else if (char === "\t") await pressKey(state, "Tab");
    else if (char === "\r") continue;
    else if (/^[\x20-\x7e]$/.test(char)) {
      const def = keyDef(char);
      const event = { key: char, ...keyEventCodes(def) };
      await send(state.tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...event, text: char, unmodifiedText: char });
      await send(state.tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
    } else {
      await send(state.tabId, "Input.insertText", { text: char });
    }
    if (delayMs) await sleep(delayMs);
  }
}
