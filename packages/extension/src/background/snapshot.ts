export interface AXValue {
  value?: unknown;
}

export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  properties?: { name: string; value: AXValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export interface FrameTree {
  refPrefix: string;
  nodes: AXNode[];
  childFrames: Map<number, string>;
}

export interface RenderOptions {
  interactiveOnly?: boolean;
}

const PASSTHROUGH_ROLES = new Set(["generic", "none", "presentation", "InlineTextBox", "LineBreak"]);
const FRAME_ROLES = new Set(["Iframe", "IframePresentational"]);
const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch", "slider",
  "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "DisclosureTriangle", "PopUpButton",
  "ColorWell", "DateTime", "InputTime",
]);
const TRUE_ONLY_PROPS = ["disabled", "focused", "selected", "required", "readonly", "multiline", "modal"];
const MAX_NAME = 200;
const MAX_URL = 150;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describe(node: AXNode, refPrefix: string): string {
  const role = String(node.role?.value ?? "unknown");
  const name = String(node.name?.value ?? "").replace(/\s+/g, " ").trim();
  const props = new Map((node.properties ?? []).map((p) => [p.name, p.value.value]));
  let line = role === "StaticText" ? "text" : role;
  if (name) line += ` ${JSON.stringify(clip(name, MAX_NAME))}`;
  if (node.backendDOMNodeId !== undefined) line += ` [ref=${refPrefix}e${node.backendDOMNodeId}]`;
  const value = node.value?.value;
  if (value !== undefined && value !== "" && String(value) !== name) line += ` [value=${JSON.stringify(clip(String(value), MAX_NAME))}]`;
  for (const prop of TRUE_ONLY_PROPS) if (props.get(prop) === true) line += ` [${prop}]`;
  for (const prop of ["checked", "pressed"]) {
    const v = props.get(prop);
    if (v !== undefined && v !== "false" && v !== false) line += v === "mixed" ? ` [${prop}=mixed]` : ` [${prop}]`;
  }
  if (props.has("expanded")) line += props.get("expanded") ? " [expanded]" : " [collapsed]";
  if (props.has("level")) line += ` [level=${props.get("level")}]`;
  if (props.get("invalid") && props.get("invalid") !== "false") line += " [invalid]";
  if (typeof props.get("url") === "string" && role === "link") line += ` [url=${clip(props.get("url") as string, MAX_URL)}]`;
  return line;
}

export function renderSnapshot(frames: Map<string, FrameTree>, rootFrameId: string, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const visited = new Set<string>();

  const renderFrame = (frameId: string, depth: number) => {
    const frame = frames.get(frameId);
    if (!frame || visited.has(frameId)) return;
    visited.add(frameId);
    const byId = new Map(frame.nodes.map((node) => [node.nodeId, node]));
    const root = frame.nodes.find((node) => !node.parentId) ?? frame.nodes[0];

    const walk = (node: AXNode, depth: number, parentName: string) => {
      const role = String(node.role?.value ?? "");
      const name = String(node.name?.value ?? "").replace(/\s+/g, " ").trim();
      const focusable = node.properties?.some((p) => p.name === "focusable" && p.value.value === true) ?? false;
      const children = (node.childIds ?? []).map((id) => byId.get(id)).filter((child): child is AXNode => !!child);

      if (role === "StaticText") {
        if (name && name !== parentName && !options.interactiveOnly) lines.push(`${"  ".repeat(depth)}- ${describe(node, frame.refPrefix)}`);
        return;
      }
      const passthrough = node.ignored || (PASSTHROUGH_ROLES.has(role) && !focusable);
      const shown = !passthrough && (!options.interactiveOnly || INTERACTIVE_ROLES.has(role) || focusable || FRAME_ROLES.has(role));
      if (shown) lines.push(`${"  ".repeat(depth)}- ${describe(node, frame.refPrefix)}`);
      const childDepth = shown && !options.interactiveOnly ? depth + 1 : depth;
      const inheritedName = passthrough ? parentName : name;
      for (const child of children) walk(child, childDepth, inheritedName);

      const childFrame = node.backendDOMNodeId === undefined ? undefined : frame.childFrames.get(node.backendDOMNodeId);
      if (childFrame) renderFrame(childFrame, childDepth);
    };

    if (root) walk(root, depth, "");
  };

  renderFrame(rootFrameId, 0);
  return lines.join("\n");
}

export function isFrameNode(node: AXNode): boolean {
  return !node.ignored && FRAME_ROLES.has(String(node.role?.value ?? "")) && node.backendDOMNodeId !== undefined;
}
