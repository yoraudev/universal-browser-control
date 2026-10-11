import type { TabState } from "./cdp";

export interface ConsoleEntry {
  ts: number;
  level: string;
  source: string;
  text: string;
  url?: string;
  line?: number;
}

export interface NetEntry {
  id: string;
  sessionId?: string;
  ts: number;
  url: string;
  method: string;
  type?: string;
  status?: number;
  status_text?: string;
  mime_type?: string;
  size?: number;
  duration_ms?: number;
  failed?: string;
  from_cache?: boolean;
  done: boolean;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  post_data?: string;
}

const MAX_CONSOLE = 1000;
const MAX_NETWORK = 1000;

function stringifyRemoteObject(object: any): string {
  if (object.value !== undefined) return typeof object.value === "string" ? object.value : JSON.stringify(object.value);
  if (object.unserializableValue) return object.unserializableValue;
  if (object.preview?.properties) {
    const body = object.preview.properties.map((p: any) => `${p.name}: ${p.value}`).join(", ");
    const more = object.preview.overflow ? ", …" : "";
    return object.subtype === "array" ? `[${body}${more}]` : `{${body}${more}}`;
  }
  return object.description ?? object.type;
}

function pushConsole(state: TabState, entry: ConsoleEntry): void {
  state.console.push(entry);
  if (state.console.length > MAX_CONSOLE) state.console.splice(0, state.console.length - MAX_CONSOLE);
}

export function recordEvent(state: TabState, sessionId: string | undefined, method: string, p: any): void {
  switch (method) {
    case "Runtime.consoleAPICalled": {
      const frame = p.stackTrace?.callFrames?.[0];
      pushConsole(state, {
        ts: Date.now(),
        level: p.type === "warning" ? "warning" : ["error", "assert"].includes(p.type) ? "error" : ["info", "debug"].includes(p.type) ? p.type : "log",
        source: "console",
        text: p.args.map(stringifyRemoteObject).join(" "),
        url: frame?.url || undefined,
        line: frame ? frame.lineNumber + 1 : undefined,
      });
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails;
      pushConsole(state, {
        ts: Date.now(),
        level: "error",
        source: "exception",
        text: d.exception?.description ?? d.text,
        url: d.url || undefined,
        line: d.lineNumber === undefined ? undefined : d.lineNumber + 1,
      });
      break;
    }
    case "Log.entryAdded": {
      const e = p.entry;
      pushConsole(state, {
        ts: Date.now(),
        level: e.level === "verbose" ? "debug" : e.level,
        source: e.source,
        text: e.text,
        url: e.url || undefined,
        line: e.lineNumber === undefined ? undefined : e.lineNumber + 1,
      });
      break;
    }
    case "Network.requestWillBeSent": {
      const previous = state.network.get(p.requestId);
      if (previous && p.redirectResponse) {
        state.network.delete(p.requestId);
        state.network.set(`${p.requestId}~${state.network.size}`, {
          ...previous,
          status: p.redirectResponse.status,
          status_text: p.redirectResponse.statusText,
          response_headers: p.redirectResponse.headers,
          done: true,
        });
      }
      state.network.set(p.requestId, {
        id: p.requestId,
        sessionId,
        ts: Date.now(),
        url: p.request.url,
        method: p.request.method,
        type: p.type,
        request_headers: p.request.headers,
        post_data: p.request.postData,
        done: false,
      });
      if (p.type !== "Document") state.inflight.add(p.requestId);
      state.lastNetworkActivity = Date.now();
      if (state.network.size > MAX_NETWORK) {
        for (const key of state.network.keys()) {
          if (state.network.size <= MAX_NETWORK) break;
          state.network.delete(key);
          state.inflight.delete(key);
        }
      }
      break;
    }
    case "Network.responseReceived": {
      const entry = state.network.get(p.requestId);
      if (!entry) break;
      entry.status = p.response.status;
      entry.status_text = p.response.statusText || undefined;
      entry.mime_type = p.response.mimeType;
      entry.response_headers = p.response.headers;
      entry.from_cache = p.response.fromDiskCache || undefined;
      entry.type ??= p.type;
      break;
    }
    case "Network.loadingFinished":
    case "Network.loadingFailed": {
      state.inflight.delete(p.requestId);
      state.lastNetworkActivity = Date.now();
      const entry = state.network.get(p.requestId);
      if (!entry) break;
      entry.done = true;
      entry.duration_ms = Date.now() - entry.ts;
      if (method === "Network.loadingFinished") entry.size = p.encodedDataLength;
      else entry.failed = p.canceled ? "canceled" : p.blockedReason ? `blocked: ${p.blockedReason}` : p.errorText;
      break;
    }
  }
}
