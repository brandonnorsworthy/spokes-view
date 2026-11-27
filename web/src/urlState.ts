import { NODE_TYPES, REFINEMENTS } from "./format";
import type { NodeType, Refinement, Shown } from "./types";

/** What the backlog's filters ask for (the same shape as `RowFilter` in backlog.ts). */
export interface UrlFilter {
  text: string;
  type: NodeType | "any" | "none";
  refinement: Refinement | "any" | "none";
}

/** URL parameter that names the node the tree page should select and centre. */
export const NODE_PARAM = "node";

/** Whether "Show done" / "Show dropped" are on, from `done=1` / `dropped=1`. */
export function shownFrom(search: string): Shown {
  const q = new URLSearchParams(search);
  return { done: q.get("done") === "1", dropped: q.get("dropped") === "1" };
}

/** Writes `show` into `params`: `done=1` / `dropped=1`, removed when off. */
export function withShown(params: URLSearchParams, show: Shown): void {
  if (show.done) params.set("done", "1");
  else params.delete("done");
  if (show.dropped) params.set("dropped", "1");
  else params.delete("dropped");
}

/** The backlog filter from a query string; anything invalid falls back to "any". */
export function filterFrom(search: string): UrlFilter {
  const q = new URLSearchParams(search);
  const type = q.get("type");
  const ref = q.get("ref");
  return {
    text: q.get("q") ?? "",
    type: type === "none" ? "none" : (NODE_TYPES.find((t) => t === type) ?? "any"),
    refinement: ref === "none" ? "none" : (REFINEMENTS.find((r) => r === ref) ?? "any"),
  };
}

/** Writes `filter` into `params`: `q`, `type`, `ref`, each removed when unset or "any". */
export function withFilter(params: URLSearchParams, filter: UrlFilter): void {
  if (filter.text !== "") params.set("q", filter.text);
  else params.delete("q");
  if (filter.type !== "any") params.set("type", filter.type);
  else params.delete("type");
  if (filter.refinement !== "any") params.set("ref", filter.refinement);
  else params.delete("ref");
}

/** The tree page's `node` id from a query string, or null when absent or invalid. */
export function nodeFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get(NODE_PARAM);
  if (raw === null) return null;
  const id = Number(raw.replace(/^SPOKE-/i, ""));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Rewrites the current URL's query in place (no history entry). */
export function replaceQuery(update: (params: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  update(url.searchParams);
  window.history.replaceState(window.history.state, "", url);
}
