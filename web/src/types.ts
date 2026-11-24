// Shapes of the Spokes read-only API (spokes `src/store/view.rs`, passed through by the
// spokes-view backend unchanged) and of the backend's own server list and errors.

export type Status = "open" | "in_progress" | "waiting" | "done" | "dropped";
export type Kind = "area" | "task";

export interface Crumb {
  id: number;
  title: string;
}

export interface ViewNode {
  id: number;
  parent: number | null;
  kind: Kind;
  ordered: boolean;
  title: string;
  status: Status;
  priority: number | null;
  effective_priority: number | null;
  focus: number | null;
  due: string | null;
  defer_until: string | null;
  deferred: boolean;
  claimed_by: string | null;
  claim_expires: string | null;
  stalled: boolean;
  waiting_on: string | null;
  answered: boolean;
  repeat: string | null;
  has_notes: boolean;
  unplanned: boolean;
  is_step: boolean;
  is_next: boolean;
  progress: { done: number; total: number } | null;
  created_at: string;
  updated_at: string;
  touched_at: string;
  child_count: number;
  descendant_count: number;
  closed_child_count: number;
  children_loaded: boolean;
}

export interface Meta {
  rev: number;
  version: string;
  time_zone: string;
  today: string;
}

export interface TreeResponse extends Meta {
  root: number;
  depth: number;
  include_closed: boolean;
  node_limit: number;
  path: Crumb[];
  truncated: boolean;
  nodes: ViewNode[];
}

export interface SpokeEvent {
  id: number;
  at: string;
  agent: string | null;
  type: string;
  detail: string | null;
}

export interface NodeResponse extends Meta {
  path: Crumb[];
  node: ViewNode & { notes: string | null };
  events: SpokeEvent[];
}

export interface HistoryEvent extends SpokeEvent {
  node: number;
  from_parent: number | null;
  to_parent: number | null;
  from_status: string | null;
  to_status: string | null;
}

/** Spokes 0.4.0+ `/api/history`: a subtree (closed nodes included) and its events. */
export interface HistoryResponse extends Meta {
  root: number;
  path: Crumb[];
  node_limit: number;
  event_limit: number;
  truncated: boolean;
  nodes: ViewNode[];
  events: HistoryEvent[];
}

/** One match from Spokes 0.5.0+ `/api/search`. */
export interface SearchHit {
  id: number;
  title: string;
  kind: Kind;
  status: Status;
  effective_priority: number | null;
  focus: number | null;
  /** Ancestors from the root down (the root included, the node itself not). */
  path: Crumb[];
  /** Why it matched when the title did not: `alias "nas"` or `in notes`. */
  via: string | null;
}

/** Spokes 0.5.0+ `/api/search`: the `search` tool's ranked matches as data. */
export interface SearchResponse extends Meta {
  query: string;
  scope: number;
  include_closed: boolean;
  keywords: string[];
  /** Matches found, before the limit. */
  total: number;
  hidden_closed: number;
  results: SearchHit[];
}

export type ServerStatus = "ok" | "unreachable" | "too_old" | "error";

export interface ServerEntry {
  name: string;
  status: ServerStatus;
  version: string | null;
  message: string | null;
}

export type ErrorCode =
  | "bad_request"
  | "unknown_server"
  | "not_found"
  | "unreachable"
  | "too_old"
  | "history_unsupported"
  | "search_unsupported"
  | "upstream_error"
  | "network";
