# Tools

This file is generated from `packages/shared/src/tools.ts` by `npm run docs:tools`. Do not edit it by hand.

There are 45 tools. Every tool except `browser_list` also accepts an optional `browser` parameter (a browser id or part of its name from `browser_list`), which is only needed when several browsers are connected.

Elements are addressed by `ref` (from `page_snapshot` or `page_find`), by CSS `selector`, or by viewport coordinates `x` / `y` in CSS pixels.

## Tabs and windows

### `browser_list`

List the browsers currently connected through the extension.

No parameters.

### `tabs_list`

List open tabs with id, url, title, window and state.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `window_id` | integer |  |  | Only tabs of this window |
| `url_contains` | string |  |  | Only tabs whose URL contains this text |

### `tab_open`

Open a new tab and wait for it to load.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string |  |  | URL to open (default: new tab page) |
| `active` | boolean |  | `true` | Focus the new tab |
| `window_id` | integer |  |  |  |
| `incognito` | boolean |  |  | Open in an incognito/private window (reuses an open one, otherwise creates it) |

### `tab_close`

Close one or more tabs.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_ids` | integer[] | yes |  |  |

### `tab_activate`

Bring a tab (and its window) to the front.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer | yes |  |  |

### `tab_navigate`

Navigate a tab to a URL, or go back / forward / reload. Waits for the load to finish.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `url` | string |  |  | URL to load |
| `action` | `"back"` or `"forward"` or `"reload"` |  |  | History action (alternative to url) |
| `bypass_cache` | boolean |  |  | With action=reload: hard reload |
| `timeout_ms` | integer |  | `30000` |  |

### `tab_update`

Pin, mute, move or duplicate a tab.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `pinned` | boolean |  |  |  |
| `muted` | boolean |  |  |  |
| `index` | integer |  |  | Move to this position (-1 = end) |
| `window_id` | integer |  |  | Move to this window |
| `duplicate` | boolean |  |  |  |

### `tab_group`

Group tabs, update a tab group, or ungroup tabs.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | `"group"` or `"update"` or `"ungroup"` or `"list"` | yes |  |  |
| `tab_ids` | integer[] |  |  | Tabs to group / ungroup |
| `group_id` | integer |  |  | Existing group to add to or update |
| `title` | string |  |  |  |
| `color` | `"grey"` or `"blue"` or `"red"` or `"yellow"` or `"green"` or `"pink"` or `"purple"` or `"cyan"` or `"orange"` |  |  |  |
| `collapsed` | boolean |  |  |  |

### `windows_list`

List browser windows with their bounds and state.

No parameters.

### `window_create`

Open a new browser window.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string |  |  |  |
| `incognito` | boolean |  |  |  |
| `type` | `"normal"` or `"popup"` |  |  |  |
| `width` | integer |  |  |  |
| `height` | integer |  |  |  |
| `left` | integer |  |  |  |
| `top` | integer |  |  |  |

### `window_update`

Resize, move, focus or change the state of a window.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `window_id` | integer |  |  | Defaults to the focused window |
| `width` | integer |  |  |  |
| `height` | integer |  |  |  |
| `left` | integer |  |  |  |
| `top` | integer |  |  |  |
| `state` | `"normal"` or `"minimized"` or `"maximized"` or `"fullscreen"` |  |  |  |
| `focused` | boolean |  |  |  |

### `window_close`

Close a window and all of its tabs.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `window_id` | integer | yes |  |  |

## Reading the page

### `page_snapshot`

Read the page as an accessibility tree, including iframes. Every element has a ref usable with click, fill, type and the other interaction tools. This is the primary way to read a page.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `interactive_only` | boolean |  | `false` | Only list interactive elements (links, buttons, inputs…) as a flat list |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `page_text`

Get the visible text of the page or of one element.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `selector` | string |  |  | Limit to this element |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `page_html`

Get the HTML of the page or of one element.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `page_screenshot`

Capture a screenshot of the viewport, the full page, or one element. The result states how image pixels map to CSS pixels for coordinate-based actions.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `full_page` | boolean |  | `false` |  |
| `format` | `"jpeg"` or `"png"` |  | `"jpeg"` |  |
| `quality` | integer |  | `80` | JPEG quality |
| `max_width` | integer |  | `1600` | Downscale if the image would be wider than this |
| `save_path` | string |  |  | Also save the image to this file path |

### `page_find`

Find elements by text, CSS selector or XPath and get refs for them.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `query` | string | yes |  |  |
| `by` | `"text"` or `"css"` or `"xpath"` |  | `"text"` |  |
| `limit` | integer |  | `20` |  |

### `page_pdf`

Print the page to a PDF file.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `save_path` | string |  |  | Where to write the PDF (default: a temp file) |
| `landscape` | boolean |  |  |  |
| `print_background` | boolean |  | `true` |  |

## Interaction

### `click`

Click an element (by ref or selector) or a viewport coordinate with a real mouse event.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `x` | number |  |  | Viewport X in CSS pixels (alternative to ref/selector) |
| `y` | number |  |  | Viewport Y in CSS pixels |
| `button` | `"left"` or `"right"` or `"middle"` |  | `"left"` |  |
| `click_count` | integer |  | `1` | 2 = double click, 3 = triple click |
| `modifiers` | `"Alt"` or `"Control"` or `"Meta"` or `"Shift"`[] |  |  | Modifier keys held during the action |

### `hover`

Move the mouse over an element or coordinate.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `x` | number |  |  | Viewport X in CSS pixels (alternative to ref/selector) |
| `y` | number |  |  | Viewport Y in CSS pixels |

### `type`

Type text with real key events into the focused element, or into the given element after clicking it.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `text` | string | yes |  |  |
| `delay_ms` | integer |  | `0` | Delay between key presses |
| `submit` | boolean |  |  | Press Enter afterwards |

### `fill`

Replace the value of an input, textarea, select or contenteditable element.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `value` | string | yes |  |  |
| `submit` | boolean |  |  | Press Enter afterwards |

### `press_key`

Press a key or shortcut, e.g. "Enter", "Escape", "ArrowDown", "Control+A", "Shift+Tab".

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `key` | string | yes |  |  |
| `repeat` | integer |  | `1` |  |

### `select_option`

Select option(s) of a <select> by value or visible label.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `values` | string[] | yes |  |  |

### `scroll`

Scroll with the mouse wheel at a position, or scroll an element into view.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `x` | number |  |  | Viewport X in CSS pixels (alternative to ref/selector) |
| `y` | number |  |  | Viewport Y in CSS pixels |
| `delta_x` | number |  | `0` |  |
| `delta_y` | number |  | `0` | Positive scrolls down. With a ref/selector and no delta, the element is scrolled into view. |

### `drag`

Press the mouse at one point, move, and release at another.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `from_ref` | string |  |  |  |
| `from_x` | number |  |  |  |
| `from_y` | number |  |  |  |
| `to_ref` | string |  |  |  |
| `to_x` | number |  |  |  |
| `to_y` | number |  |  |  |
| `steps` | integer |  | `10` |  |

### `upload_file`

Set the files of an <input type=file>.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `paths` | string[] | yes |  | Absolute file paths on this machine |

### `handle_dialog`

Accept or dismiss an open alert / confirm / prompt / beforeunload dialog.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `accept` | boolean |  | `true` |  |
| `prompt_text` | string |  |  |  |

### `wait_for`

Wait until all given conditions hold, or just wait for a duration.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `text` | string |  |  | Text that must appear on the page |
| `text_gone` | string |  |  | Text that must disappear |
| `selector` | string |  |  | CSS selector that must match |
| `selector_gone` | string |  |  | CSS selector that must stop matching |
| `url_contains` | string |  |  |  |
| `network_idle` | boolean |  |  | No requests in flight for 500ms |
| `time_ms` | integer |  |  | Fixed wait |
| `timeout_ms` | integer |  | `15000` |  |

## DevTools

### `evaluate_js`

Run JavaScript in the page and return the result. Top-level await is supported.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `expression` | string | yes |  |  |
| `frame` | string |  |  | Run inside a cross-origin iframe: the frame prefix of its refs, e.g. "s2" |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `console_messages`

Read console output and uncaught errors. Recording starts when the tab is first used by a DevTools tool; reload to capture from page load.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `level` | `"error"` or `"warning"` or `"info"` or `"log"` or `"debug"` |  |  | Only this level |
| `contains` | string |  |  |  |
| `limit` | integer |  | `100` | Most recent N entries |
| `clear` | boolean |  |  | Clear the buffer after reading |

### `network_requests`

List recorded network requests. Recording starts when the tab is first used by a DevTools tool; reload to capture from page load. Pass request_id for full headers and post data.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `request_id` | string |  |  |  |
| `url_contains` | string |  |  |  |
| `method` | string |  |  |  |
| `resource_type` | string |  |  | e.g. Document, XHR, Fetch, Script, Image |
| `min_status` | integer |  |  | e.g. 400 for errors only |
| `failed_only` | boolean |  |  |  |
| `limit` | integer |  | `100` | Most recent N entries |
| `clear` | boolean |  |  |  |

### `network_response_body`

Get the response body of a recorded request.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `request_id` | string | yes |  |  |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `network_control`

Block URLs, throttle or go offline, disable the cache, or add request headers.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `blocked_urls` | string[] |  |  | URL patterns (* wildcard) to block; [] clears |
| `offline` | boolean |  |  |  |
| `latency_ms` | number |  |  |  |
| `download_kbps` | number |  |  | -1 = unlimited |
| `upload_kbps` | number |  |  | -1 = unlimited |
| `cache_disabled` | boolean |  |  |  |
| `extra_headers` | object |  |  |  |
| `reset` | boolean |  |  | Clear all of the above |

### `emulate`

Emulate a viewport / device, user agent, geolocation, timezone or color scheme.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `width` | integer |  |  |  |
| `height` | integer |  |  |  |
| `device_scale_factor` | number |  |  |  |
| `mobile` | boolean |  |  |  |
| `user_agent` | string |  |  |  |
| `latitude` | number |  |  |  |
| `longitude` | number |  |  |  |
| `timezone` | string |  |  | e.g. "Europe/Istanbul" |
| `color_scheme` | `"light"` or `"dark"` |  |  |  |
| `reset` | boolean |  |  | Clear all emulation |

### `dom_inspect`

Inspect an element: attributes, box, computed styles, event listeners, outer HTML.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `ref` | string |  |  | Element ref from page_snapshot or page_find, e.g. "e42" |
| `selector` | string |  |  | CSS selector (alternative to ref) |
| `styles` | string[] |  |  | Computed style properties to return (default: a common set) |

### `performance_metrics`

Get navigation timing, paint timings and runtime metrics for the page.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |

### `cdp_send`

Send a raw Chrome DevTools Protocol command to the tab. Escape hatch for anything DevTools can do that has no dedicated tool.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `method` | string | yes |  | e.g. "CSS.getComputedStyleForNode" |
| `params` | object |  |  |  |
| `frame` | string |  |  | Target a cross-origin iframe session, e.g. "s2" |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `cdp_events`

Subscribe to raw CDP events for the tab and read the ones buffered so far.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `subscribe` | string[] |  |  | Event names or domain wildcards, e.g. "Network.webSocketFrameReceived", "Fetch.*" |
| `unsubscribe` | string[] |  |  |  |
| `limit` | integer |  | `50` |  |
| `clear` | boolean |  |  |  |
| `max_chars` | integer |  | `30000` | Maximum characters to return |
| `offset` | integer |  | `0` | Character offset, to page through long output |

### `release_tab`

Stop controlling a tab (or every tab): detaches the debugger and removes the on-page control indicator and the browser's debugging bar. Call this as soon as you have finished working with a tab. The next tool call on the tab takes control of it again.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Omit to release every tab |

## Browser data

### `cookies`

Read, set or delete cookies.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | `"get"` or `"set"` or `"delete"` | yes |  |  |
| `url` | string |  |  | URL the cookie applies to (required for set/delete) |
| `domain` | string |  |  | With get: filter by domain |
| `name` | string |  |  |  |
| `value` | string |  |  |  |
| `path` | string |  |  |  |
| `secure` | boolean |  |  |  |
| `http_only` | boolean |  |  |  |
| `same_site` | `"no_restriction"` or `"lax"` or `"strict"` |  |  |  |
| `expires` | number |  |  | Unix time in seconds; omit for a session cookie |

### `storage`

Read or modify the page's localStorage / sessionStorage.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tab_id` | integer |  |  | Tab id from tabs_list. Defaults to the active tab of the focused window. |
| `area` | `"local"` or `"session"` |  | `"local"` |  |
| `action` | `"get"` or `"set"` or `"remove"` or `"clear"` | yes |  |  |
| `key` | string |  |  | With get: omit to return everything |
| `value` | string |  |  |  |

### `downloads`

List, start or cancel downloads.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | `"list"` or `"start"` or `"cancel"` | yes |  |  |
| `url` | string |  |  | With start |
| `filename` | string |  |  | With start: path relative to the downloads folder |
| `download_id` | integer |  |  | With cancel |
| `query` | string |  |  | With list: search text |
| `limit` | integer |  | `20` |  |

### `history_search`

Search the browsing history.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string |  | `""` |  |
| `days` | number |  | `7` | How far back to look |
| `limit` | integer |  | `50` |  |

### `bookmarks`

Search, list, create or remove bookmarks.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | `"search"` or `"tree"` or `"create"` or `"remove"` | yes |  |  |
| `query` | string |  |  |  |
| `id` | string |  |  | With remove |
| `parent_id` | string |  |  | With create |
| `title` | string |  |  |  |
| `url` | string |  |  |  |
