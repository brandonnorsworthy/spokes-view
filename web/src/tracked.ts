import type { TrackedEntry } from "./types";

/** URL parameter that opens the Tracked page. */
export const TRACKED_PARAM = "tracked";

export function trackedUrl(server: string): string {
  return `/?${new URLSearchParams({ server, [TRACKED_PARAM]: "1" }).toString()}`;
}

/** Whether the query string asks for the Tracked page. */
export function isTrackedPage(search: string): boolean {
  return new URLSearchParams(search).get(TRACKED_PARAM) === "1";
}

/** Share of the node's tasks done, 0 to 100 (an empty one counts as done). */
export function percentDone(p: TrackedEntry["progress"]): number {
  return p.total === 0 ? 100 : Math.round((p.done / p.total) * 100);
}

/**
 * Whether nothing is left to do: the node itself is done or dropped, or every task under
 * it is done. A tracked node with no tasks under it that is still open is not finished.
 */
export function isFinished(e: TrackedEntry): boolean {
  if (e.node.status === "done" || e.node.status === "dropped") return true;
  return e.progress.total > 0 && e.progress.done === e.progress.total;
}

/**
 * Tracked nodes with work still open first, finished ones after (SPOKE-1170). Within each
 * group the server's order (newest tracked first) is kept.
 */
export function sortTracked(nodes: TrackedEntry[]): TrackedEntry[] {
  return [...nodes.filter((e) => !isFinished(e)), ...nodes.filter(isFinished)];
}
