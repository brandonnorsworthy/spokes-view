import type {
  ErrorCode,
  HistoryResponse,
  NodeResponse,
  SearchResponse,
  ServerEntry,
  Shown,
  TrackedResponse,
  TreeResponse,
} from "./types";

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
  "search_unsupported",
  "tracked_unsupported",
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

/** `include_closed` is the done nodes, `include_dropped` the dropped ones (Spokes 0.6.0+). */
function showParams(show: Shown): string {
  return `include_closed=${String(show.done)}&include_dropped=${String(show.dropped)}`;
}

export async function listServers(): Promise<ServerEntry[]> {
  const r = await getJson<{ servers: ServerEntry[] }>("/api/servers", null);
  return r.data?.servers ?? [];
}

export interface TreeQuery {
  root: number;
  depth: number;
  show: Shown;
}

export function treeUrl(server: string, q: TreeQuery): string {
  return `/api/servers/${enc(server)}/tree?root=${q.root}&depth=${q.depth}&${showParams(q.show)}`;
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
  show: Shown,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Fetched<NodeResponse>> {
  return getJson<NodeResponse>(
    `/api/servers/${enc(server)}/nodes/${id}?${showParams(show)}`,
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

/** Ranked matches for `query` (Spokes 0.5.0+): typos, aliases and notes count. */
/** The nodes marked tracked through MCP, with progress (Spokes 0.15.0+). */
export function fetchTracked(
  server: string,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Fetched<TrackedResponse>> {
  return getJson<TrackedResponse>(`/api/servers/${enc(server)}/tracked`, etag, signal);
}

export async function fetchSearch(
  server: string,
  query: string,
  show: Shown,
  limit: number,
  signal?: AbortSignal,
  /** Page start; sent only when above 0, so an older Spokes never sees it. */
  offset = 0,
): Promise<SearchResponse> {
  const r = await getJson<SearchResponse>(
    `/api/servers/${enc(server)}/search?q=${enc(query)}&limit=${String(limit)}${offset > 0 ? `&offset=${String(offset)}` : ""}&${showParams(show)}`,
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
