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
