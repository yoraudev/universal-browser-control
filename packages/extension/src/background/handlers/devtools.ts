import { detach, detachAll, send, sessionForFrame } from "../cdp";
import { callOnNode, resolveNode } from "../input";
import { act, evaluate, page, paginate, paginateText, type Handler } from "./common";

const DEFAULT_STYLES = [
  "display", "visibility", "opacity", "position", "z-index", "width", "height", "margin", "padding", "color",
  "background-color", "font-family", "font-size", "font-weight", "overflow", "cursor", "pointer-events",
];

const INSPECT_ELEMENT = `function (styleNames) {
  const rect = this.getBoundingClientRect();
  const computed = getComputedStyle(this);
  const html = this.outerHTML;
  return {
    tag: this.tagName.toLowerCase(),
    attributes: Object.fromEntries([...this.attributes].map((a) => [a.name, a.value])),
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles: Object.fromEntries(styleNames.map((name) => [name, computed.getPropertyValue(name)])),
    child_count: this.children.length,
    outer_html: html.length > 2000 ? html.slice(0, 2000) + "…" : html,
  };
}`;

const PERFORMANCE = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const paint = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)]));
  const resources = performance.getEntriesByType("resource");
  return {
    url: location.href,
    navigation: nav && {
      type: nav.type,
      ttfb_ms: Math.round(nav.responseStart),
      dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
      load_ms: Math.round(nav.loadEventEnd),
      transfer_size: nav.transferSize,
    },
    paint,
    resources: { count: resources.length, transfer_size: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) },
  };
})()`;

function stringify(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 1) ?? "undefined");
}

export const devtoolsHandlers: Record<string, Handler> = {
  async evaluate_js(p) {
    const state = await page(p);
    const output = await act(state, async () => {
      const sessionId = sessionForFrame(state, p.frame);
      const failure = (details: any) => new Error(details.exception?.description ?? details.text);
      const evaluated = await send(state.tabId, "Runtime.evaluate", { expression: p.expression, userGesture: true, replMode: true, objectGroup: "ubc" }, sessionId);
      if (evaluated.exceptionDetails) throw failure(evaluated.exceptionDetails);
      let result = evaluated.result;
      if (result.objectId) {
        const resolved =
          result.subtype === "promise"
            ? await send(state.tabId, "Runtime.awaitPromise", { promiseObjectId: result.objectId, returnByValue: true }, sessionId)
            : await send(state.tabId, "Runtime.callFunctionOn", { objectId: result.objectId, functionDeclaration: "function () { return this; }", returnByValue: true }, sessionId);
        if (resolved.exceptionDetails && result.subtype === "promise") throw failure(resolved.exceptionDetails);
        if (!resolved.exceptionDetails && (resolved.result.value !== undefined || resolved.result.type === "undefined")) result = resolved.result;
      }
      const value = result.value !== undefined ? result.value : (result.unserializableValue ?? (result.type === "undefined" ? "undefined" : result.description));
      return { result: paginateText(stringify(value), p) };
    });
    return output;
  },

  async console_messages(p) {
    const state = await page(p, { allowDialog: true });
    const entries = state.console
      .filter((entry) => (!p.level || entry.level === p.level) && (!p.contains || entry.text.includes(p.contains)))
      .slice(-p.limit)
      .map((entry) => ({ ...entry, ts: new Date(entry.ts).toISOString() }));
    const total = state.console.length;
    if (p.clear) state.console.length = 0;
    return { tab_id: state.tabId, total_recorded: total, messages: entries };
  },

  async network_requests(p) {
    const state = await page(p, { allowDialog: true });
    if (p.request_id) {
      const entry = state.network.get(p.request_id);
      if (!entry) throw new Error(`No recorded request with id ${p.request_id}`);
      const { sessionId: _, ...detail } = entry;
      return { ...detail, ts: new Date(entry.ts).toISOString() };
    }
    const matches = [...state.network.values()].filter(
      (entry) =>
        (!p.url_contains || entry.url.includes(p.url_contains)) &&
        (!p.method || entry.method === p.method.toUpperCase()) &&
        (!p.resource_type || entry.type?.toLowerCase() === p.resource_type.toLowerCase()) &&
        (p.min_status === undefined || (entry.status ?? 0) >= p.min_status) &&
        (!p.failed_only || entry.failed || (entry.status ?? 0) >= 400),
    );
    const total = state.network.size;
    if (p.clear) {
      state.network.clear();
      state.inflight.clear();
    }
    return {
      tab_id: state.tabId,
      total_recorded: total,
      matched: matches.length,
      requests: matches.slice(-p.limit).map((entry) => ({
        id: entry.id,
        method: entry.method,
        url: entry.url.length > 300 ? `${entry.url.slice(0, 300)}…` : entry.url,
        type: entry.type,
        status: entry.status,
        mime_type: entry.mime_type,
        size: entry.size,
        duration_ms: entry.duration_ms,
        failed: entry.failed,
        pending: entry.done ? undefined : true,
      })),
    };
  },

  async network_response_body(p) {
    const state = await page(p, { allowDialog: true });
    const entry = state.network.get(p.request_id);
    if (!entry) throw new Error(`No recorded request with id ${p.request_id}`);
    const { body, base64Encoded } = await send(state.tabId, "Network.getResponseBody", { requestId: p.request_id }, entry.sessionId);
    return { url: entry.url, status: entry.status, mime_type: entry.mime_type, base64_encoded: base64Encoded || undefined, ...paginate(body, p) };
  },

  async network_control(p) {
    const state = await page(p, { allowDialog: true });
    const applied: Record<string, unknown> = {};
    const blocked = p.reset ? [] : p.blocked_urls;
    if (blocked) {
      await send(state.tabId, "Network.setBlockedURLs", { urls: blocked });
      applied.blocked_urls = blocked;
    }
    const throttled = [p.offline, p.latency_ms, p.download_kbps, p.upload_kbps].some((v) => v !== undefined);
    if (p.reset || throttled) {
      const bytesPerSecond = (kbps?: number) => (kbps === undefined || kbps < 0 ? -1 : (kbps * 1000) / 8);
      const conditions = p.reset
        ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
        : { offline: !!p.offline, latency: p.latency_ms ?? 0, downloadThroughput: bytesPerSecond(p.download_kbps), uploadThroughput: bytesPerSecond(p.upload_kbps) };
      await send(state.tabId, "Network.emulateNetworkConditions", conditions);
      applied.conditions = conditions;
    }
    const cacheDisabled = p.reset ? false : p.cache_disabled;
    if (cacheDisabled !== undefined) {
      await send(state.tabId, "Network.setCacheDisabled", { cacheDisabled });
      applied.cache_disabled = cacheDisabled;
    }
    const headers = p.reset ? {} : p.extra_headers;
    if (headers) {
      await send(state.tabId, "Network.setExtraHTTPHeaders", { headers });
      applied.extra_headers = headers;
    }
    return { tab_id: state.tabId, applied };
  },

  async emulate(p) {
    const state = await page(p);
    const applied: string[] = [];
    if (p.reset) {
      await Promise.all([
        send(state.tabId, "Emulation.clearDeviceMetricsOverride"),
        send(state.tabId, "Emulation.setUserAgentOverride", { userAgent: "" }),
        send(state.tabId, "Emulation.clearGeolocationOverride"),
        send(state.tabId, "Emulation.setTimezoneOverride", { timezoneId: "" }),
        send(state.tabId, "Emulation.setEmulatedMedia", { features: [] }),
        send(state.tabId, "Emulation.setTouchEmulationEnabled", { enabled: false }),
      ]);
      applied.push("reset");
    }
    if (p.width !== undefined || p.height !== undefined || p.device_scale_factor !== undefined || p.mobile !== undefined) {
      const current = await evaluate<{ w: number; h: number }>(state, "({ w: innerWidth, h: innerHeight })");
      await send(state.tabId, "Emulation.setDeviceMetricsOverride", {
        width: p.width ?? current.w,
        height: p.height ?? current.h,
        deviceScaleFactor: p.device_scale_factor ?? 0,
        mobile: !!p.mobile,
      });
      await send(state.tabId, "Emulation.setTouchEmulationEnabled", { enabled: !!p.mobile });
      applied.push("viewport");
    }
    if (p.user_agent !== undefined) {
      await send(state.tabId, "Emulation.setUserAgentOverride", { userAgent: p.user_agent });
      applied.push("user_agent");
    }
    if (p.latitude !== undefined && p.longitude !== undefined) {
      await send(state.tabId, "Emulation.setGeolocationOverride", { latitude: p.latitude, longitude: p.longitude, accuracy: 10 });
      applied.push("geolocation");
    }
    if (p.timezone !== undefined) {
      await send(state.tabId, "Emulation.setTimezoneOverride", { timezoneId: p.timezone });
      applied.push("timezone");
    }
    if (p.color_scheme !== undefined) {
      await send(state.tabId, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: p.color_scheme }] });
      applied.push("color_scheme");
    }
    return { tab_id: state.tabId, applied, note: "Emulation lasts until reset or until the debugger detaches from the tab." };
  },

  async dom_inspect(p) {
    const state = await page(p);
    const node = await resolveNode(state, p);
    const info = await callOnNode<object>(state, node, INSPECT_ELEMENT, [p.styles ?? DEFAULT_STYLES]);
    const { object } = await send(state.tabId, "DOM.resolveNode", { backendNodeId: node.backendNodeId, objectGroup: "ubc" }, node.sessionId);
    const { listeners } = await send(state.tabId, "DOMDebugger.getEventListeners", { objectId: object.objectId }, node.sessionId).catch(() => ({
      listeners: [],
    }));
    return { ...info, event_listeners: [...new Set((listeners as { type: string }[]).map((l) => l.type))] };
  },

  async performance_metrics(p) {
    const state = await page(p);
    await send(state.tabId, "Performance.enable");
    const [{ metrics }, timing] = await Promise.all([send(state.tabId, "Performance.getMetrics"), evaluate<object>(state, PERFORMANCE)]);
    const wanted = ["Nodes", "Documents", "Frames", "JSEventListeners", "LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration", "JSHeapUsedSize", "JSHeapTotalSize"];
    const runtime = Object.fromEntries((metrics as { name: string; value: number }[]).filter((m) => wanted.includes(m.name)).map((m) => [m.name, m.value]));
    return { tab_id: state.tabId, ...timing, runtime };
  },

  async cdp_send(p) {
    const state = await page(p, { allowDialog: true });
    const result = await send(state.tabId, p.method, p.params ?? {}, sessionForFrame(state, p.frame), 60_000);
    return paginateText(stringify(result ?? {}), p);
  },

  async cdp_events(p) {
    const state = await page(p, { allowDialog: true });
    for (const name of p.subscribe ?? []) state.subscriptions.add(name);
    for (const name of p.unsubscribe ?? []) state.subscriptions.delete(name);
    const events = state.events.slice(-p.limit).map((event) => ({ ...event, ts: new Date(event.ts).toISOString() }));
    const buffered = state.events.length;
    if (p.clear) state.events.length = 0;
    return paginateText(stringify({ tab_id: state.tabId, subscriptions: [...state.subscriptions], buffered, events }), p);
  },

  async release_tab(p) {
    if (p.tab_id === undefined) return { released: await detachAll() };
    await detach(p.tab_id);
    return { released: [p.tab_id] };
  },
};
