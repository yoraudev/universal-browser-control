import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "packages/extension/dist");
const serverEntry = join(root, "packages/mcp-server/dist/index.cjs");
const ubcPort = 19000 + Math.floor(Math.random() * 200);
const home = mkdtempSync(join(tmpdir(), "ubc-e2e-"));

const FRAME = `<!doctype html><title>Frame</title><button onclick="this.textContent='framed!'">Frame button</button>`;
const SECOND = `<!doctype html><title>Second</title><h1>Second page</h1>`;
const mainPage = (port) => `<!doctype html><title>UBC Test</title>
<body style="margin:0">
<h1>Hello UBC</h1>
<input id="name" aria-label="Name">
<select id="color" aria-label="Color"><option value="r">Red</option><option value="g">Green</option></select>
<button id="go" onclick="out.textContent='clicked:'+document.getElementById('name').value">Go</button>
<button id="alert" onclick="alert('hi there'); out.textContent='alerted'">Alert</button>
<a id="newtab" href="/second" target="_blank">Open second</a>
<input type="file" id="file" aria-label="Upload" onchange="out.textContent='file:'+this.files[0].name">
<div id="out"></div>
<iframe src="/frame" title="same" width="300" height="60"></iframe>
<iframe src="http://127.0.0.1:${port}/frame" title="cross" width="300" height="60"></iframe>
<div style="height:3000px"></div>
<div id="bottom" style="background:#ff0000;height:400px">Bottom</div>
<script>const out = document.getElementById('out'); console.log('page ready', {a: 1}); fetch('/api/data').then(r => r.json());</script>
</body>`;

const site = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/data") return res.writeHead(200, { "content-type": "application/json" }).end('{"hello":"world"}');
  const body = path === "/frame" ? FRAME : path === "/second" ? SECOND : mainPage(site.address().port);
  res.writeHead(200, { "content-type": "text/html" }).end(body);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${site.address().port}`;

async function mcpClient(name) {
  const client = new Client({ name, version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [serverEntry], env: { ...process.env, UBC_PORT: String(ubcPort), UBC_HOME: home }, stderr: "inherit" }),
  );
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {}
  return { value, text, images: result.content.filter((c) => c.type === "image") };
}

const failures = [];
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
  }
}

const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: [extensionDir] });
let client, client2;
try {
  const workerTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 15000 });
  const worker = await workerTarget.worker();
  await worker.evaluate((port) => chrome.storage.local.set({ port, label: "e2e" }), ubcPort);

  client = await mcpClient("e2e-1");
  const t = (name, args) => call(client, name, args);
  const js = async (expression, tab_id) => (await t("evaluate_js", { expression, tab_id })).value.result;
  const refOf = (snapshot, pattern) => {
    const match = new RegExp(`${pattern}[^\\n]*?\\[ref=(\\w+)\\]`).exec(snapshot);
    assert.ok(match, `no ref for /${pattern}/ in snapshot:\n${snapshot}`);
    return match[1];
  };
  let tabId;

  await check("lists tools", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 45, `only ${tools.length} tools`);
    assert.ok(tools.find((tool) => tool.name === "click").inputSchema.properties.browser, "browser param missing");
  });

  await check("browser connects and is listed", async () => {
    let list = [];
    for (let i = 0; i < 40 && !list.length; i++) {
      list = (await t("browser_list")).value;
      if (!list.length) await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(list.length, 1);
    assert.match(list[0].name, /e2e/);
  });

  await check("tab_open / tabs_list / windows_list", async () => {
    const opened = (await t("tab_open", { url: origin })).value;
    tabId = opened.id;
    assert.equal(opened.title, "UBC Test");
    const tabs = (await t("tabs_list", { url_contains: origin })).value;
    assert.ok(tabs.some((tab) => tab.id === tabId));
    assert.ok((await t("windows_list")).value.length >= 1);
  });

  await check("tabs opened by the model are grouped under the client's name", async () => {
    const groupId = (await t("tabs_list")).value.find((tab) => tab.id === tabId).group_id;
    const groups = (await t("tab_group", { action: "list" })).value;
    assert.equal(groups.find((group) => group.id === groupId)?.title, "E2e 1");
    const another = (await t("tab_open", { url: `${origin}/second`, active: false })).value;
    assert.equal(another.group_id, groupId);
    await t("tab_close", { tab_ids: [another.id] });
  });

  let snapshot;
  await check("page_snapshot includes same-origin and cross-origin iframes", async () => {
    snapshot = (await t("page_snapshot", { tab_id: tabId })).text;
    assert.match(snapshot, /button "Go" \[ref=e\d+\]/);
    assert.match(snapshot, /button "Frame button" \[ref=e\d+\]/);
    assert.match(snapshot, /button "Frame button" \[ref=s\d+e\d+\]/);
    const interactive = (await t("page_snapshot", { tab_id: tabId, interactive_only: true })).text;
    assert.doesNotMatch(interactive, /heading/);
    assert.match(interactive, /textbox "Name"/);
  });

  const hasIndicator = (id) => js("!!document.querySelector('[data-ubc-indicator][aria-hidden=true]')", id);
  await check("controlled tab shows an indicator that the model does not see", async () => {
    assert.equal(await hasIndicator(tabId), "true");
    assert.doesNotMatch(snapshot, /controlled by/);
    assert.doesNotMatch((await t("page_text", { tab_id: tabId })).value.text, /controlled by/);
    if (process.env.UBC_E2E_SHOT) {
      const pages = await browser.pages();
      await worker.evaluate((id) => chrome.tabs.setZoom(id, 1.4), tabId);
      await new Promise((r) => setTimeout(r, 700));
      await pages.find((page) => page.url().startsWith(origin)).screenshot({ path: process.env.UBC_E2E_SHOT });
      await worker.evaluate((id) => chrome.tabs.setZoom(id, 1), tabId);
    }
  });

  await check("indicator follows the tab group's color and keeps its text readable", async () => {
    const palette = { grey: "#5f6368", blue: "#1a73e8", red: "#d93025", green: "#188038", pink: "#d01884", purple: "#a142f4", cyan: "#007b83" };
    const style = (name) => js(`getComputedStyle(document.querySelector('[data-ubc-indicator]')).getPropertyValue('${name}')`, tabId);
    const groupId = (await t("tabs_list")).value.find((tab) => tab.id === tabId).group_id;
    const group = (await t("tab_group", { action: "list" })).value.find((candidate) => candidate.id === groupId);
    assert.ok(palette[group.color], `unexpected random color ${group.color}`);
    assert.equal(await style("--ubc-color"), palette[group.color]);
    assert.equal(await style("--ubc-text"), "#ffffff");
    const recolor = group.color === "red" ? "green" : "red";
    await t("tab_group", { action: "update", group_id: groupId, color: recolor });
    await t("wait_for", { time_ms: 400 });
    assert.equal(await style("--ubc-color"), palette[recolor]);
    await t("tab_group", { action: "update", group_id: groupId, color: "yellow" });
    await t("wait_for", { time_ms: 400 });
    assert.equal(await style("--ubc-color"), "#f9ab00");
    assert.equal(await style("--ubc-text"), "#202124");
    await t("tab_group", { action: "update", group_id: groupId, color: group.color });
  });

  await check("fill + click + page_text", async () => {
    await t("fill", { tab_id: tabId, ref: refOf(snapshot, 'textbox "Name"'), value: "Ada" });
    const clicked = (await t("click", { tab_id: tabId, ref: refOf(snapshot, 'button "Go"') })).value;
    assert.equal(clicked.tab_id, tabId);
    assert.match((await t("page_text", { tab_id: tabId })).value.text, /clicked:Ada/);
  });

  await check("type with real key events, press_key shortcut", async () => {
    await t("type", { tab_id: tabId, selector: "#name", text: " Löve1!" });
    assert.equal(await js("document.getElementById('name').value", tabId), "Ada Löve1!");
    await t("press_key", { tab_id: tabId, key: "Control+A" });
    await t("press_key", { tab_id: tabId, key: "Backspace" });
    assert.equal(await js("document.getElementById('name').value", tabId), "");
    await t("fill", { tab_id: tabId, selector: "#name", value: "x" });
    await t("fill", { tab_id: tabId, selector: "#name", value: "" });
    assert.equal(await js("document.getElementById('name').value", tabId), "");
  });

  await check("select_option", async () => {
    const result = (await t("select_option", { tab_id: tabId, ref: refOf(snapshot, 'combobox "Color"'), values: ["Green"] })).value;
    assert.deepEqual(result.selected, ["Green"]);
    assert.equal(await js("document.getElementById('color').value", tabId), "g");
  });

  await check("click inside same-origin and cross-origin iframes", async () => {
    const same = /button "Frame button" \[ref=(e\d+)\]/.exec(snapshot)[1];
    const cross = /button "Frame button" \[ref=(s\d+e\d+)\]/.exec(snapshot)[1];
    await t("click", { tab_id: tabId, ref: same });
    await t("click", { tab_id: tabId, ref: cross });
    const after = (await t("page_snapshot", { tab_id: tabId })).text;
    assert.equal(after.match(/button "framed!"/g)?.length, 2, after);
    assert.equal(await js("document.querySelector('button').textContent", undefined).catch(() => ""), "Go");
    assert.equal((await t("evaluate_js", { tab_id: tabId, expression: "document.querySelector('button').textContent", frame: cross.split("e")[0] })).value.result, "framed!");
  });

  await check("dialog is reported and handled", async () => {
    const clicked = (await t("click", { tab_id: tabId, selector: "#alert" })).value;
    assert.equal(clicked.dialog?.message, "hi there");
    await assert.rejects(t("page_text", { tab_id: tabId }), /dialog is open/);
    await t("handle_dialog", { tab_id: tabId });
    await t("wait_for", { tab_id: tabId, text: "alerted", timeout_ms: 5000 });
  });

  await check("link opening a new tab is reported", async () => {
    const clicked = (await t("click", { tab_id: tabId, selector: "#newtab" })).value;
    assert.equal(clicked.new_tabs?.length, 1);
    await t("tab_close", { tab_ids: [clicked.new_tabs[0].id] });
    await t("tab_activate", { tab_id: tabId });
  });

  await check("upload_file", async () => {
    const file = join(home, "hello.txt");
    writeFileSync(file, "hi");
    await t("upload_file", { tab_id: tabId, selector: "#file", paths: [file] });
    assert.match((await t("page_text", { tab_id: tabId })).value.text, /file:hello\.txt/);
  });

  await check("page_find / dom_inspect / page_html", async () => {
    const found = (await t("page_find", { tab_id: tabId, query: "Open second" })).value;
    assert.equal(found[0].tag, "a");
    assert.match(found[0].ref, /^e\d+$/);
    assert.equal((await t("page_find", { tab_id: tabId, query: "button", by: "css" })).value.length, 2);
    const info = (await t("dom_inspect", { tab_id: tabId, ref: found[0].ref })).value;
    assert.equal(info.attributes.id, "newtab");
    assert.equal(info.styles.display, "inline");
    assert.match((await t("page_html", { tab_id: tabId, selector: "h1" })).text, /<h1>Hello UBC<\/h1>/);
  });

  await check("scroll + viewport screenshot shows the scrolled region", async () => {
    const wheel = (await t("scroll", { tab_id: tabId, delta_y: 300 })).value;
    assert.ok(wheel.scroll_y > 0, JSON.stringify(wheel));
    await t("scroll", { tab_id: tabId, selector: "#bottom" });
    const shot = await t("page_screenshot", { tab_id: tabId, format: "png" });
    assert.equal(shot.images.length, 1);
    assert.equal(shot.value.css_pixels_per_image_pixel, 1);
    const pixel = await js(
      `(async () => {
        const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64,${shot.images[0].data}")).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        const rect = document.getElementById("bottom").getBoundingClientRect();
        const y = Math.round(Math.max(rect.top, 0) + 30);
        return { size: [bitmap.width, bitmap.height], viewport: [innerWidth, innerHeight], y, corner: [...ctx.getImageData(1, 1, 1, 1).data].slice(0, 3), rgb: [...ctx.getImageData(200, y, 1, 1).data].slice(0, 3) };
      })()`,
      tabId,
    );
    const info = JSON.parse(pixel);
    assert.deepEqual(info.rgb, [255, 0, 0], JSON.stringify(info));
    assert.deepEqual(info.size, info.viewport);
    assert.deepEqual(info.corner, [255, 255, 255]);
    assert.equal(await js("getComputedStyle(document.querySelector('[data-ubc-indicator]')).display", tabId), "block");
  });

  await check("full page and element screenshots, jpeg, save_path", async () => {
    const full = await t("page_screenshot", { tab_id: tabId, full_page: true });
    assert.equal(full.value.region, "full_page");
    assert.match(full.images[0].mimeType, /jpeg/);
    assert.ok(Number(full.value.image_size.split("x")[1]) > 3000, full.value.image_size);
    const path = join(home, "shots", "el.png");
    const element = await t("page_screenshot", { tab_id: tabId, selector: "#go", format: "png", save_path: path });
    assert.equal(element.value.region, "element");
    assert.ok(statSync(path).size > 50);
  });

  await check("console and network recording, response body", async () => {
    await t("tab_navigate", { tab_id: tabId, action: "reload" });
    await t("wait_for", { tab_id: tabId, network_idle: true });
    const logs = (await t("console_messages", { tab_id: tabId, contains: "page ready" })).value;
    assert.equal(logs.messages.at(-1).text, "page ready {a: 1}");
    const requests = (await t("network_requests", { tab_id: tabId, url_contains: "/api/data" })).value.requests;
    assert.equal(requests.at(-1).status, 200);
    assert.equal((await t("network_response_body", { tab_id: tabId, request_id: requests.at(-1).id })).value.text, '{"hello":"world"}');
    const detail = (await t("network_requests", { tab_id: tabId, request_id: requests.at(-1).id })).value;
    assert.ok(detail.response_headers);
    const errors = (await t("evaluate_js", { tab_id: tabId, expression: "console.error('bad thing'); 1" })).value;
    assert.equal(errors.result, "1");
    assert.equal((await t("console_messages", { tab_id: tabId, level: "error" })).value.messages.at(-1).text, "bad thing");
  });

  await check("evaluate_js: values, await, errors", async () => {
    assert.equal(await js("1 + 1", tabId), "2");
    assert.equal(await js("await new Promise(r => setTimeout(() => r('later'), 50))", tabId), "later");
    assert.equal(await js("({ a: [1, 2] })", tabId), JSON.stringify({ a: [1, 2] }, null, 1));
    await assert.rejects(t("evaluate_js", { tab_id: tabId, expression: "nope()" }), /ReferenceError/);
  });

  await check("network_control blocks requests", async () => {
    await t("network_control", { tab_id: tabId, blocked_urls: ["*/api/data*"] });
    assert.equal(await js("await fetch('/api/data').then(() => 'ok', () => 'blocked')", tabId), "blocked");
    await t("network_control", { tab_id: tabId, reset: true });
    assert.equal(await js("await fetch('/api/data').then(() => 'ok', () => 'blocked')", tabId), "ok");
  });

  await check("emulate viewport and color scheme", async () => {
    await t("emulate", { tab_id: tabId, width: 400, height: 700, color_scheme: "dark" });
    assert.equal(await js("innerWidth + ':' + matchMedia('(prefers-color-scheme: dark)').matches", tabId), "400:true");
    await t("emulate", { tab_id: tabId, width: 500, height: 400, device_scale_factor: 2 });
    for (const format of ["png", "jpeg"]) {
      const shot = (await t("page_screenshot", { tab_id: tabId, format })).value;
      assert.equal(shot.image_size, "500x400");
      assert.equal(shot.css_pixels_per_image_pixel, 1);
    }
    assert.equal((await t("page_screenshot", { tab_id: tabId, max_width: 250 })).value.css_pixels_per_image_pixel, 2);
    await t("emulate", { tab_id: tabId, reset: true });
    assert.notEqual(await js("innerWidth", tabId), "500");
  });

  await check("cdp_send / cdp_events / performance_metrics", async () => {
    const doc = (await t("cdp_send", { tab_id: tabId, method: "DOM.getDocument", params: { depth: 0 } })).value;
    assert.equal(doc.root.nodeName, "#document");
    await t("cdp_events", { tab_id: tabId, subscribe: ["Runtime.consoleAPICalled"] });
    await js("console.log('evt')", tabId);
    const events = (await t("cdp_events", { tab_id: tabId })).value;
    assert.equal(events.events.at(-1).method, "Runtime.consoleAPICalled");
    const perf = (await t("performance_metrics", { tab_id: tabId })).value;
    assert.ok(perf.runtime.Nodes > 0 && perf.navigation.load_ms >= 0);
  });

  await check("cookies and storage", async () => {
    await t("cookies", { action: "set", url: origin, name: "ubc", value: "42" });
    assert.equal((await t("cookies", { action: "get", url: origin, name: "ubc" })).value[0].value, "42");
    assert.equal((await t("cookies", { action: "delete", url: origin, name: "ubc" })).value.deleted, true);
    await t("storage", { tab_id: tabId, action: "set", key: "k", value: "v" });
    assert.deepEqual((await t("storage", { tab_id: tabId, action: "get" })).value, { k: "v" });
    assert.equal((await t("storage", { tab_id: tabId, action: "clear" })).value.items, 0);
  });

  await check("page_pdf writes a file", async () => {
    const path = join(home, "page.pdf");
    const result = (await t("page_pdf", { tab_id: tabId, save_path: path })).value;
    assert.ok(existsSync(result.saved_to) && statSync(path).size > 1000);
  });

  await check("navigation: url, back, forward", async () => {
    assert.equal((await t("tab_navigate", { tab_id: tabId, url: `${origin}/second` })).value.title, "Second");
    assert.equal((await t("tab_navigate", { tab_id: tabId, action: "back" })).value.title, "UBC Test");
    assert.equal((await t("tab_navigate", { tab_id: tabId, action: "forward" })).value.title, "Second");
    assert.match((await t("page_snapshot", { tab_id: tabId })).text, /heading "Second page"/);
    assert.equal(await hasIndicator(tabId), "true");
  });

  await check("tab_update, tab_group, window tools", async () => {
    assert.equal((await t("tab_update", { tab_id: tabId, pinned: true })).value.pinned, true);
    await t("tab_update", { tab_id: tabId, pinned: false });
    const group = (await t("tab_group", { action: "group", tab_ids: [tabId], title: "ubc", color: "blue" })).value;
    assert.equal(group.title, "ubc");
    await t("tab_group", { action: "ungroup", tab_ids: [tabId] });
    const win = (await t("window_create", { url: `${origin}/second`, width: 500, height: 400 })).value;
    assert.equal((await t("window_update", { window_id: win.id, width: 640, height: 480 })).value.width, 640);
    await t("window_close", { window_id: win.id });
  });

  await check("history, bookmarks, downloads", async () => {
    assert.ok(Array.isArray((await t("history_search", { query: "localhost" })).value));
    const created = (await t("bookmarks", { action: "create", title: "UBC", url: origin })).value;
    assert.ok((await t("bookmarks", { action: "search", query: "UBC" })).value.some((b) => b.id === created.id));
    await t("bookmarks", { action: "remove", id: created.id });
    assert.ok(Array.isArray((await t("downloads", { action: "list" })).value));
  });

  await check("helpful errors: stale ref, bad arguments, restricted page", async () => {
    await assert.rejects(t("click", { tab_id: tabId, ref: "e999999" }), /no longer exists/);
    await assert.rejects(t("click", { tab_id: tabId }), /ref, a selector, or both x and y/);
    await assert.rejects(t("tab_activate", {}), /Invalid arguments/);
    const internal = (await t("tab_open", { url: "chrome://version" })).value;
    await assert.rejects(t("page_snapshot", { tab_id: internal.id }), /cannot be controlled/);
    await t("tab_close", { tab_ids: [internal.id] });
  });

  const pageOf = async (url) => (await browser.pages()).find((candidate) => candidate.url() === url);
  const indicatorShown = (target) => target.evaluate(() => !!document.querySelector("[data-ubc-indicator]"));
  const until = async (condition, timeoutMs) => {
    for (const started = Date.now(); Date.now() - started < timeoutMs; await new Promise((r) => setTimeout(r, 250))) {
      if (await condition()) return true;
    }
    return false;
  };

  await check("indicator goes away after a minute without commands and returns with the next one", async () => {
    const url = `${origin}/second?idle`;
    const idle = (await t("tab_open", { url })).value;
    await t("page_snapshot", { tab_id: idle.id });
    const target = await pageOf(url);
    assert.ok(await until(() => indicatorShown(target), 5000), "indicator never appeared");
    assert.ok(await until(async () => !(await indicatorShown(target)), 70000), "indicator stayed while idle");
    assert.equal((await t("tabs_list")).value.find((tab) => tab.id === idle.id).debugger_attached, true);
    await t("page_snapshot", { tab_id: idle.id });
    assert.ok(await until(() => indicatorShown(target), 5000), "indicator did not return");
    await t("tab_close", { tab_ids: [idle.id] });
  });

  await check("a second MCP server process relays through the first, then takes over", async () => {
    client2 = await mcpClient("e2e-2");
    assert.ok((await call(client2, "tabs_list")).value.some((tab) => tab.id === tabId));
    assert.match((await call(client2, "page_text", { tab_id: tabId })).value.text, /Second page/);
    await client.close();
    client = undefined;
    let tabs;
    for (let i = 0; i < 30 && !tabs; i++) {
      tabs = await call(client2, "tabs_list").then((r) => r.value, () => undefined);
      if (!tabs) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(tabs?.some((tab) => tab.id === tabId), "extension did not reconnect to the new hub");
  });

  await check("debugger_detach", async () => {
    assert.ok((await call(client2, "debugger_detach")).value.detached.includes(tabId));
    assert.ok(!(await call(client2, "tabs_list")).value.find((tab) => tab.id === tabId).debugger_attached);
    const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(origin));
    assert.equal(await page.evaluate(() => !!document.querySelector("[data-ubc-indicator]")), false);
  });
} finally {
  await client?.close().catch(() => {});
  await client2?.close().catch(() => {});
  await browser.close().catch(() => {});
  site.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
