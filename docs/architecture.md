# Architecture

Universal Browser Control has two runtime parts and one shared package.

```
MCP client ──stdio──> MCP server ──WebSocket 127.0.0.1:9234──> extension service worker ──> browser
```

| Package | Runs in | Role |
| --- | --- | --- |
| `packages/shared` | both | Wire protocol types and the tool definitions |
| `packages/mcp-server` | Node.js | Speaks MCP over stdio, forwards tool calls to the extension |
| `packages/extension` | Browser (Manifest V3 service worker) | Executes tool calls with `chrome.debugger` (CDP) and `chrome.*` APIs |

## Tool definitions

`packages/shared/src/tools.ts` is the single source of truth for tools: name, description, Zod input schema and target. The MCP server turns each schema into JSON Schema for `tools/list`, validates arguments against it, and applies defaults before forwarding. The extension never imports this file, so Zod is not bundled into it; it trusts the validated parameters.

A tool's target is either `server` (answered by the MCP server itself, currently only `browser_list`) or `extension`. Every `extension` tool automatically gets an optional `browser` parameter.

Adding a tool means adding its definition to `tools.ts` and a handler with the same name in `packages/extension/src/background/handlers/`.

[tools.md](tools.md) lists every tool and its parameters. It is generated from `tools.ts` by `scripts/generate-tools-doc.mjs`; run `npm run docs:tools` after changing a tool.

## MCP server

### Hub and relay

Each MCP client starts its own server process, but the extension connects to one port. `Bridge` (`bridge.ts`) resolves this:

1. It tries to listen on the port. If that works, the process becomes the **hub** (`hub.ts`).
2. If the port is taken, it connects to the existing hub as a **relay** (`relay.ts`) and sends its tool calls through it.
3. When a relay loses its hub, it runs the same procedure again, so one of the remaining processes becomes the new hub and the extension reconnects to it.

The hub exposes two WebSocket paths:

| Path | Who connects | Accepted when |
| --- | --- | --- |
| `/extension` | The browser extension | `Origin` starts with `chrome-extension://` (and matches `UBC_EXTENSION_IDS` if set) |
| `/client` | Relay processes | No `Origin` header and a valid `x-ubc-token` header |

Every server process has a random client id. A relay announces its id with a `hello` when it connects. The hub sends the extension a `clients` message listing the ids that are present (its own and those of its relays) when the extension connects and whenever a relay joins or leaves.

Browsers always send `Origin` on WebSocket handshakes and cannot set custom headers, so web pages can reach neither path. The token is a random value in `~/.universal-browser-control/token`, created by the first process that needs it.

### Requests

A tool call becomes a `request` message with a numeric id; the extension answers with a `response` carrying either `result` or `error`. The hub keeps a pending map with a timeout per request (60 seconds, extended by the tool's own `timeout_ms` / `time_ms`).

If no browser is connected, the hub waits up to 8 seconds for one before failing. If several are connected, the call must name one with `browser` (id or part of the name).

The server also passes the MCP client's name (from the `initialize` handshake) and its client id with every request. The extension uses the name for the tab group title and the on-page indicator, and the id to know which client controls a tab.

### Results

Handlers return plain JSON, which the server serializes as text. For binary data they return a rich result (`$rich: true`) with optional `images` (returned inline as MCP image content) and `file` (always written to disk by the server, which then reports the path). `save_path` on `page_screenshot` writes the first image to disk as well.

## Extension

### Connection

`connection.ts` opens a WebSocket to `ws://127.0.0.1:<port>/extension` and sends a `hello` with the browser's id, name and version. A ping every 20 seconds keeps the Manifest V3 service worker alive. While the worker is alive, a closed socket is retried with backoff (1 to 10 seconds); a 30-second alarm covers the case where the worker has been suspended. Port, label and the on/off switch live in `chrome.storage.local`; changing any of them reconnects.

Five seconds after a `clients` message or a lost connection, the extension detaches from the tabs whose client is no longer present, or from every tab if it is still disconnected. The delay covers a relay taking over as hub.

### Debugger sessions

`cdp.ts` attaches `chrome.debugger` to a tab lazily, the first time a tool needs it, and keeps per-tab state: sessions, dialog, console and network buffers, event subscriptions, the controller name and the id of the client that last used the tab. Tools that only need `chrome.tabs` (listing, opening, closing, navigating) never attach.

On attach it enables the Page, Runtime, Network, Log and DOM domains and turns on flat auto-attach, which gives every out-of-process iframe its own CDP session on the same connection. Each iframe session gets a short index used in refs.

### Refs

`page_snapshot` reads the accessibility tree of every frame in every session and renders it as an indented outline (`snapshot.ts`). Each element carries a ref built from its backend DOM node id:

- `e42` is node 42 in the main target.
- `s2e17` is node 17 in the out-of-process iframe session with index 2.

Backend node ids are stable for the lifetime of a document, so refs stay valid until the page navigates; there is no ref table to invalidate. A ref that no longer resolves produces an error telling the model to take a new snapshot. Iframe trees are inlined under their iframe element by resolving which frame each iframe node hosts.

### Input

`input.ts` resolves a target (ref, CSS selector, or viewport coordinates) to a point: it scrolls the node into view, reads its content quads, and for out-of-process iframes adds the offset of the iframe element in its parent. Mouse and keyboard actions are dispatched with CDP `Input.*` events, so pages see trusted events. Modifier keys are always released, even if a shortcut fails midway.

### Actions and dialogs

Interaction handlers run inside `act` (`handlers/common.ts`), which reports what the action led to: the tab's URL and title, tabs it opened, and any JavaScript dialog. A dialog blocks the page and the pending CDP command, so `act` returns as soon as a dialog opens instead of waiting. While a dialog is open, other page tools fail fast and point to `handle_dialog`.

### Recording

`recorders.ts` keeps the last 1000 console entries and 1000 network requests per tab, starting when the debugger attaches. Document requests are excluded from the in-flight set used by `wait_for`'s `network_idle`, because a cross-origin iframe's document request starts in one session and finishes in another; the tab's load state covers them instead.

### Screenshots

Viewport screenshots are captured without a clip, in device pixels, and scaled down to CSS pixels inside the service worker. Passing a clip makes Chrome re-render the page through device emulation, which visibly disturbs it. Full-page and element screenshots still need a clip. The result states how image pixels map to CSS pixels.

### Indicator and tab groups

`indicator.ts` injects an overlay into every controlled tab: an outline and a top-center label naming the controller. It is a `div` with a closed shadow root and inline `!important` styles so page CSS cannot affect it, it is `aria-hidden` so it stays out of snapshots, it is hidden while a screenshot is captured, and it counter-scales the tab's zoom. It is re-injected after navigation and removed when the debugger detaches.

The overlay shows activity, not attachment. Every tool call on a tab restarts a 60-second timer; when it runs out and no request is in progress, the overlay is removed while the debugger stays attached, and the next tool call puts it back.

Tabs opened through `tab_open` or `window_create` go into a tab group titled with the controller name. New groups get a random color from those that keep white text readable. The indicator takes its tab group's color and switches to dark text for light colors.

## Builds and releases

Both packages are bundled with esbuild: the server into a single `dist/index.cjs`, the extension into `dist/` with its manifest, popup and icons. The `UBC_VERSION` environment variable overrides the version written into both.

`.github/workflows/release.yml` runs on every push to `main`: type check, unit tests, compute the next version (major and minor from the root `package.json`, patch one higher than the latest matching tag), build, and publish a release with the extension zip and the server file.

## Tests

- `packages/*/test` holds unit tests (Vitest): hub routing, origin and token checks, relay takeover, client announcements, snapshot rendering, indicator colors.
- `e2e/run.mjs` starts Chrome for Testing with the built extension, connects a real MCP client to the built server, and exercises every tool group against local test pages.
