import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  target: "extension" | "server";
  input: z.ZodObject<any>;
}

const tab = {
  tab_id: z.number().int().optional().describe("Tab id from tabs_list. Defaults to the active tab of the focused window."),
};
const element = {
  ref: z.string().optional().describe('Element ref from page_snapshot or page_find, e.g. "e42"'),
  selector: z.string().optional().describe("CSS selector (alternative to ref)"),
};
const point = {
  x: z.number().optional().describe("Viewport X in CSS pixels (alternative to ref/selector)"),
  y: z.number().optional().describe("Viewport Y in CSS pixels"),
};
const modifiers = z
  .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
  .optional()
  .describe("Modifier keys held during the action");
const paging = {
  max_chars: z.number().int().positive().default(30000).describe("Maximum characters to return"),
  offset: z.number().int().min(0).default(0).describe("Character offset, to page through long output"),
};

function tool(name: string, target: ToolDef["target"], description: string, shape: z.ZodRawShape = {}): ToolDef {
  return { name, description, target, input: z.object(shape) };
}

export const TOOLS: ToolDef[] = [
  tool("browser_list", "server", "List the browsers currently connected through the extension."),
  tool("tabs_list", "extension", "List open tabs with id, url, title, window and state.", {
    window_id: z.number().int().optional().describe("Only tabs of this window"),
    url_contains: z.string().optional().describe("Only tabs whose URL contains this text"),
  }),
  tool("tab_open", "extension", "Open a new tab and wait for it to load.", {
    url: z.string().optional().describe("URL to open (default: new tab page)"),
    active: z.boolean().default(true).describe("Focus the new tab"),
    window_id: z.number().int().optional(),
    incognito: z.boolean().optional().describe("Open in an incognito/private window (reuses an open one, otherwise creates it)"),
  }),
  tool("tab_close", "extension", "Close one or more tabs.", {
    tab_ids: z.array(z.number().int()).min(1),
  }),
  tool("tab_activate", "extension", "Bring a tab (and its window) to the front.", {
    tab_id: z.number().int(),
  }),
  tool("tab_navigate", "extension", "Navigate a tab to a URL, or go back / forward / reload. Waits for the load to finish.", {
    ...tab,
    url: z.string().optional().describe("URL to load"),
    action: z.enum(["back", "forward", "reload"]).optional().describe("History action (alternative to url)"),
    bypass_cache: z.boolean().optional().describe("With action=reload: hard reload"),
    timeout_ms: z.number().int().positive().default(30000),
  }),
  tool("tab_update", "extension", "Pin, mute, move or duplicate a tab.", {
    ...tab,
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    index: z.number().int().optional().describe("Move to this position (-1 = end)"),
    window_id: z.number().int().optional().describe("Move to this window"),
    duplicate: z.boolean().optional(),
  }),
  tool("tab_group", "extension", "Group tabs, update a tab group, or ungroup tabs.", {
    action: z.enum(["group", "update", "ungroup", "list"]),
    tab_ids: z.array(z.number().int()).optional().describe("Tabs to group / ungroup"),
    group_id: z.number().int().optional().describe("Existing group to add to or update"),
    title: z.string().optional(),
    color: z.enum(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]).optional(),
    collapsed: z.boolean().optional(),
  }),
  tool("windows_list", "extension", "List browser windows with their bounds and state."),
  tool("window_create", "extension", "Open a new browser window.", {
    url: z.string().optional(),
    incognito: z.boolean().optional(),
    type: z.enum(["normal", "popup"]).optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    left: z.number().int().optional(),
    top: z.number().int().optional(),
  }),
  tool("window_update", "extension", "Resize, move, focus or change the state of a window.", {
    window_id: z.number().int().optional().describe("Defaults to the focused window"),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    left: z.number().int().optional(),
    top: z.number().int().optional(),
    state: z.enum(["normal", "minimized", "maximized", "fullscreen"]).optional(),
    focused: z.boolean().optional(),
  }),
  tool("window_close", "extension", "Close a window and all of its tabs.", {
    window_id: z.number().int(),
  }),

  tool(
    "page_snapshot",
    "extension",
    "Read the page as an accessibility tree, including iframes. Every element has a ref usable with click, fill, type and the other interaction tools. This is the primary way to read a page.",
    {
      ...tab,
      interactive_only: z.boolean().default(false).describe("Only list interactive elements (links, buttons, inputs…) as a flat list"),
      ...paging,
    },
  ),
  tool("page_text", "extension", "Get the visible text of the page or of one element.", {
    ...tab,
    selector: z.string().optional().describe("Limit to this element"),
    ...paging,
  }),
  tool("page_html", "extension", "Get the HTML of the page or of one element.", {
    ...tab,
    ...element,
    ...paging,
  }),
  tool(
    "page_screenshot",
    "extension",
    "Capture a screenshot of the viewport, the full page, or one element. The result states how image pixels map to CSS pixels for coordinate-based actions.",
    {
      ...tab,
      ...element,
      full_page: z.boolean().default(false),
      format: z.enum(["jpeg", "png"]).default("jpeg"),
      quality: z.number().int().min(1).max(100).default(80).describe("JPEG quality"),
      max_width: z.number().int().positive().default(1600).describe("Downscale if the image would be wider than this"),
      save_path: z.string().optional().describe("Also save the image to this file path"),
    },
  ),
  tool("page_find", "extension", "Find elements by text, CSS selector or XPath and get refs for them.", {
    ...tab,
    query: z.string(),
    by: z.enum(["text", "css", "xpath"]).default("text"),
    limit: z.number().int().positive().max(100).default(20),
  }),
  tool("page_pdf", "extension", "Print the page to a PDF file.", {
    ...tab,
    save_path: z.string().optional().describe("Where to write the PDF (default: a temp file)"),
    landscape: z.boolean().optional(),
    print_background: z.boolean().default(true),
  }),

  tool("click", "extension", "Click an element (by ref or selector) or a viewport coordinate with a real mouse event.", {
    ...tab,
    ...element,
    ...point,
    button: z.enum(["left", "right", "middle"]).default("left"),
    click_count: z.number().int().min(1).max(3).default(1).describe("2 = double click, 3 = triple click"),
    modifiers,
  }),
  tool("hover", "extension", "Move the mouse over an element or coordinate.", { ...tab, ...element, ...point }),
  tool("type", "extension", "Type text with real key events into the focused element, or into the given element after clicking it.", {
    ...tab,
    ...element,
    text: z.string(),
    delay_ms: z.number().int().min(0).default(0).describe("Delay between key presses"),
    submit: z.boolean().optional().describe("Press Enter afterwards"),
  }),
  tool("fill", "extension", "Replace the value of an input, textarea, select or contenteditable element.", {
    ...tab,
    ...element,
    value: z.string(),
    submit: z.boolean().optional().describe("Press Enter afterwards"),
  }),
  tool("press_key", "extension", 'Press a key or shortcut, e.g. "Enter", "Escape", "ArrowDown", "Control+A", "Shift+Tab".', {
    ...tab,
    key: z.string(),
    repeat: z.number().int().min(1).max(100).default(1),
  }),
  tool("select_option", "extension", "Select option(s) of a <select> by value or visible label.", {
    ...tab,
    ...element,
    values: z.array(z.string()).min(1),
  }),
  tool("scroll", "extension", "Scroll with the mouse wheel at a position, or scroll an element into view.", {
    ...tab,
    ...element,
    ...point,
    delta_x: z.number().default(0),
    delta_y: z.number().default(0).describe("Positive scrolls down. With a ref/selector and no delta, the element is scrolled into view."),
  }),
  tool("drag", "extension", "Press the mouse at one point, move, and release at another.", {
    ...tab,
    from_ref: z.string().optional(),
    from_x: z.number().optional(),
    from_y: z.number().optional(),
    to_ref: z.string().optional(),
    to_x: z.number().optional(),
    to_y: z.number().optional(),
    steps: z.number().int().min(1).max(100).default(10),
  }),
  tool("upload_file", "extension", "Set the files of an <input type=file>.", {
    ...tab,
    ...element,
    paths: z.array(z.string()).min(1).describe("Absolute file paths on this machine"),
  }),
  tool("handle_dialog", "extension", "Accept or dismiss an open alert / confirm / prompt / beforeunload dialog.", {
    ...tab,
    accept: z.boolean().default(true),
    prompt_text: z.string().optional(),
  }),
  tool("wait_for", "extension", "Wait until all given conditions hold, or just wait for a duration.", {
    ...tab,
    text: z.string().optional().describe("Text that must appear on the page"),
    text_gone: z.string().optional().describe("Text that must disappear"),
    selector: z.string().optional().describe("CSS selector that must match"),
    selector_gone: z.string().optional().describe("CSS selector that must stop matching"),
    url_contains: z.string().optional(),
    network_idle: z.boolean().optional().describe("No requests in flight for 500ms"),
    time_ms: z.number().int().min(0).optional().describe("Fixed wait"),
    timeout_ms: z.number().int().positive().default(15000),
  }),

  tool("evaluate_js", "extension", "Run JavaScript in the page and return the result. Top-level await is supported.", {
    ...tab,
    expression: z.string(),
    frame: z.string().optional().describe('Run inside a cross-origin iframe: the frame prefix of its refs, e.g. "s2"'),
    ...paging,
  }),
  tool(
    "console_messages",
    "extension",
    "Read console output and uncaught errors. Recording starts when the tab is first used by a DevTools tool; reload to capture from page load.",
    {
      ...tab,
      level: z.enum(["error", "warning", "info", "log", "debug"]).optional().describe("Only this level"),
      contains: z.string().optional(),
      limit: z.number().int().positive().default(100).describe("Most recent N entries"),
      clear: z.boolean().optional().describe("Clear the buffer after reading"),
    },
  ),
  tool(
    "network_requests",
    "extension",
    "List recorded network requests. Recording starts when the tab is first used by a DevTools tool; reload to capture from page load. Pass request_id for full headers and post data.",
    {
      ...tab,
      request_id: z.string().optional(),
      url_contains: z.string().optional(),
      method: z.string().optional(),
      resource_type: z.string().optional().describe("e.g. Document, XHR, Fetch, Script, Image"),
      min_status: z.number().int().optional().describe("e.g. 400 for errors only"),
      failed_only: z.boolean().optional(),
      limit: z.number().int().positive().default(100).describe("Most recent N entries"),
      clear: z.boolean().optional(),
    },
  ),
  tool("network_response_body", "extension", "Get the response body of a recorded request.", {
    ...tab,
    request_id: z.string(),
    ...paging,
  }),
  tool("network_control", "extension", "Block URLs, throttle or go offline, disable the cache, or add request headers.", {
    ...tab,
    blocked_urls: z.array(z.string()).optional().describe("URL patterns (* wildcard) to block; [] clears"),
    offline: z.boolean().optional(),
    latency_ms: z.number().min(0).optional(),
    download_kbps: z.number().optional().describe("-1 = unlimited"),
    upload_kbps: z.number().optional().describe("-1 = unlimited"),
    cache_disabled: z.boolean().optional(),
    extra_headers: z.record(z.string(), z.string()).optional(),
    reset: z.boolean().optional().describe("Clear all of the above"),
  }),
  tool("emulate", "extension", "Emulate a viewport / device, user agent, geolocation, timezone or color scheme.", {
    ...tab,
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    device_scale_factor: z.number().optional(),
    mobile: z.boolean().optional(),
    user_agent: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    timezone: z.string().optional().describe('e.g. "Europe/Istanbul"'),
    color_scheme: z.enum(["light", "dark"]).optional(),
    reset: z.boolean().optional().describe("Clear all emulation"),
  }),
  tool("dom_inspect", "extension", "Inspect an element: attributes, box, computed styles, event listeners, outer HTML.", {
    ...tab,
    ...element,
    styles: z.array(z.string()).optional().describe("Computed style properties to return (default: a common set)"),
  }),
  tool("performance_metrics", "extension", "Get navigation timing, paint timings and runtime metrics for the page.", { ...tab }),
  tool(
    "cdp_send",
    "extension",
    "Send a raw Chrome DevTools Protocol command to the tab. Escape hatch for anything DevTools can do that has no dedicated tool.",
    {
      ...tab,
      method: z.string().describe('e.g. "CSS.getComputedStyleForNode"'),
      params: z.record(z.string(), z.any()).optional(),
      frame: z.string().optional().describe('Target a cross-origin iframe session, e.g. "s2"'),
      ...paging,
    },
  ),
  tool("cdp_events", "extension", "Subscribe to raw CDP events for the tab and read the ones buffered so far.", {
    ...tab,
    subscribe: z.array(z.string()).optional().describe('Event names or domain wildcards, e.g. "Network.webSocketFrameReceived", "Fetch.*"'),
    unsubscribe: z.array(z.string()).optional(),
    limit: z.number().int().positive().default(50),
    clear: z.boolean().optional(),
    ...paging,
  }),
  tool("debugger_detach", "extension", "Detach the debugger from a tab (or all tabs), removing the browser's debugging banner.", {
    tab_id: z.number().int().optional().describe("Omit to detach from every tab"),
  }),

  tool("cookies", "extension", "Read, set or delete cookies.", {
    action: z.enum(["get", "set", "delete"]),
    url: z.string().optional().describe("URL the cookie applies to (required for set/delete)"),
    domain: z.string().optional().describe("With get: filter by domain"),
    name: z.string().optional(),
    value: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    http_only: z.boolean().optional(),
    same_site: z.enum(["no_restriction", "lax", "strict"]).optional(),
    expires: z.number().optional().describe("Unix time in seconds; omit for a session cookie"),
  }),
  tool("storage", "extension", "Read or modify the page's localStorage / sessionStorage.", {
    ...tab,
    area: z.enum(["local", "session"]).default("local"),
    action: z.enum(["get", "set", "remove", "clear"]),
    key: z.string().optional().describe("With get: omit to return everything"),
    value: z.string().optional(),
  }),
  tool("downloads", "extension", "List, start or cancel downloads.", {
    action: z.enum(["list", "start", "cancel"]),
    url: z.string().optional().describe("With start"),
    filename: z.string().optional().describe("With start: path relative to the downloads folder"),
    download_id: z.number().int().optional().describe("With cancel"),
    query: z.string().optional().describe("With list: search text"),
    limit: z.number().int().positive().default(20),
  }),
  tool("history_search", "extension", "Search the browsing history.", {
    query: z.string().default(""),
    days: z.number().positive().default(7).describe("How far back to look"),
    limit: z.number().int().positive().default(50),
  }),
  tool("bookmarks", "extension", "Search, list, create or remove bookmarks.", {
    action: z.enum(["search", "tree", "create", "remove"]),
    query: z.string().optional(),
    id: z.string().optional().describe("With remove"),
    parent_id: z.string().optional().describe("With create"),
    title: z.string().optional(),
    url: z.string().optional(),
  }),
];
