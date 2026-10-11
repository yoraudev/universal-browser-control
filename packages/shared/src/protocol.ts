export const DEFAULT_PORT = 9234;
export const EXTENSION_PATH = "/extension";
export const CLIENT_PATH = "/client";
export const TOKEN_HEADER = "x-ubc-token";

export interface BrowserInfo {
  id: string;
  name: string;
  version: string;
  extensionVersion: string;
}

export type Params = Record<string, any>;

export interface RequestMessage {
  type: "request";
  id: number;
  method: string;
  params: Params;
  browser?: string;
  timeoutMs?: number;
  client?: string;
  clientId?: string;
}

export interface CallOptions {
  browser?: string;
  timeoutMs?: number;
  client?: string;
  clientId?: string;
}

export const CLIENT_PARAM = "$client";
export const CLIENT_ID_PARAM = "$clientId";

export interface ResponseMessage {
  type: "response";
  id: number;
  result?: unknown;
  error?: string;
}

export type ExtensionToHub = { type: "hello"; info: BrowserInfo } | ResponseMessage | { type: "ping" };
export type HubToExtension = RequestMessage | { type: "pong" } | { type: "clients"; ids: string[] };
export type ClientToHub = RequestMessage | { type: "hello"; clientId: string };

export interface RichResult {
  $rich: true;
  text?: unknown;
  images?: { data: string; mimeType: string }[];
  file?: { data: string; ext: string };
}

export function isRichResult(value: unknown): value is RichResult {
  return typeof value === "object" && value !== null && (value as RichResult).$rich === true;
}
