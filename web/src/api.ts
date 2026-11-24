import type { ErrorCode, HistoryResponse, NodeResponse, ServerEntry, TreeResponse } from "./types";

/** An error from the backend (or the network), with the backend's error code. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A fresh body, or `null` when the server answered 304 (unchanged). */
export interface Fetched<T> {
  data: T | null;
  etag: string | null;
}

const KNOWN_CODES: readonly ErrorCode[] = [
  "bad_request",
  "unknown_server",
  "not_found",
  "unreachable",
  "too_old",
  "history_unsupported",
  "upstream_error",
];

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    const code = KNOWN_CODES.find((c) => c === body.code) ?? "upstream_error";
    const msg = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    return new ApiError(code, res.status, msg);
  } catch {
    return new ApiError("upstream_error", res.status, `HTTP ${res.status}`);
  }
}

/**
 * GET with our own ETag handling: `cache: "no-store"` keeps the browser cache out of
 * it, so a 304 reaches this code and costs no parsing.
 */
async function getJson<T>(
  url: string,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Fetched<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (etag) headers["If-None-Match"] = etag;
  let res: Response;
  try {
    res = await fetch(url, { headers, cache: "no-store", signal: signal ?? null });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("network", 0, "cannot reach the spokes-view service");
  }
  if (res.status === 304) return { data: null, etag };
  if (!res.ok) throw await toError(res);
  return { data: (await res.json()) as T, etag: res.headers.get("ETag") };
}

const enc = encodeURIComponent;

export async function listServers(): Promise<ServerEntry[]> {
  const r = await getJson<{ servers: ServerEntry[] }>("/api/servers", null);
  return r.data?.servers ?? [];
}

export interface TreeQuery {
  root: number;
  depth: number;
  includeClosed: boolean;
}

export function treeUrl(server: string, q: TreeQuery): string {
  return `/api/servers/${enc(server)}/tree?root=${q.root}&depth=${q.depth}&include_closed=${q.includeClosed}`;
}

export function fetchTree(
  server: string,
  q: TreeQuery,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Fetched<TreeResponse>> {
  return getJson<TreeResponse>(treeUrl(server, q), etag, signal);
}

export function fetchNode(
  server: string,
  id: number,
  includeClosed: boolean,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Fetched<NodeResponse>> {
  return getJson<NodeResponse>(
    `/api/servers/${enc(server)}/nodes/${id}?include_closed=${includeClosed}`,
    etag,
    signal,
  );
}

/** A subtree's whole history (Spokes 0.4.0+), for replay. */
export async function fetchHistory(
  server: string,
  root: number,
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  const r = await getJson<HistoryResponse>(
    `/api/servers/${enc(server)}/history?root=${String(root)}`,
    null,
    signal,
  );
  if (!r.data) throw new ApiError("upstream_error", 304, "unexpected 304");
  return r.data;
}

/** True when a Spokes version string is at least `major.minor`. */
export function versionAtLeast(version: string | null, major: number, minor: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a > major || (a === major && b >= minor);
}
