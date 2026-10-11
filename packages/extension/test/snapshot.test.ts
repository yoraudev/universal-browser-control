import { describe, expect, it } from "vitest";
import { renderSnapshot, type AXNode, type FrameTree } from "../src/background/snapshot";

const node = (nodeId: string, role: string, name: string, extra: Partial<AXNode> = {}): AXNode => ({
  nodeId,
  role: { value: role },
  name: { value: name },
  backendDOMNodeId: Number(nodeId),
  ...extra,
});

const main: AXNode[] = [
  node("1", "RootWebArea", "Shop", { childIds: ["2", "5", "7", "9"] }),
  node("2", "generic", "", { parentId: "1", childIds: ["3"] }),
  node("3", "link", "Home", { parentId: "2", childIds: ["4"], properties: [{ name: "url", value: { value: "https://x.test/" } }] }),
  node("4", "StaticText", "Home", { parentId: "3" }),
  node("5", "textbox", "Search", { parentId: "1", value: { value: "shoes" }, properties: [{ name: "focused", value: { value: true } }] }),
  node("6", "none", "", { parentId: "1", ignored: true }),
  node("7", "heading", "Results", { parentId: "1", childIds: ["8"], properties: [{ name: "level", value: { value: 2 } }] }),
  node("8", "StaticText", "Results for shoes", { parentId: "7" }),
  node("9", "Iframe", "", { parentId: "1" }),
];
const child: AXNode[] = [
  node("1", "RootWebArea", "Ad", { childIds: ["2"] }),
  node("2", "button", "Buy", { parentId: "1", properties: [{ name: "disabled", value: { value: true } }] }),
];
const frames = new Map<string, FrameTree>([
  ["main", { refPrefix: "", nodes: main, childFrames: new Map([[9, "child"]]) }],
  ["child", { refPrefix: "s1", nodes: child, childFrames: new Map() }],
]);

describe("renderSnapshot", () => {
  it("renders an outline with refs, state and nested iframes", () => {
    expect(renderSnapshot(frames, "main")).toBe(
      [
        '- RootWebArea "Shop" [ref=e1]',
        '  - link "Home" [ref=e3] [url=https://x.test/]',
        '  - textbox "Search" [ref=e5] [value="shoes"] [focused]',
        '  - heading "Results" [ref=e7] [level=2]',
        '    - text "Results for shoes" [ref=e8]',
        "  - Iframe [ref=e9]",
        '    - RootWebArea "Ad" [ref=s1e1]',
        '      - button "Buy" [ref=s1e2] [disabled]',
      ].join("\n"),
    );
  });

  it("lists only interactive elements when asked", () => {
    expect(renderSnapshot(frames, "main", { interactiveOnly: true })).toBe(
      [
        '- link "Home" [ref=e3] [url=https://x.test/]',
        '- textbox "Search" [ref=e5] [value="shoes"] [focused]',
        "- Iframe [ref=e9]",
        '- button "Buy" [ref=s1e2] [disabled]',
      ].join("\n"),
    );
  });
});
