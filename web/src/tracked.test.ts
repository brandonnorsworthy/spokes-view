import { describe, expect, it } from "vitest";
import { isFinished, isTrackedPage, percentDone, sortTracked, trackedUrl } from "./tracked";
import type { TrackedEntry, Status } from "./types";

describe("tracked page", () => {
  it("has its own URL", () => {
    expect(trackedUrl("My Home")).toBe("/?server=My+Home&tracked=1");
    expect(isTrackedPage("?server=Home&tracked=1")).toBe(true);
    expect(isTrackedPage("?server=Home&kanban=4")).toBe(false);
  });

  it("rounds the share done, and an empty node counts as done", () => {
    expect(percentDone({ done: 2, in_progress: 1, total: 22 })).toBe(9);
    expect(percentDone({ done: 14, in_progress: 0, total: 14 })).toBe(100);
    expect(percentDone({ done: 0, in_progress: 0, total: 0 })).toBe(100);
  });

  it("puts finished nodes after ones with open work, keeping the order otherwise", () => {
    const e = (id: number, status: Status, done: number, total: number): TrackedEntry =>
      ({
        node: { id, status },
        path: [],
        progress: { done, in_progress: 0, total },
        tracked_at: "",
      }) as unknown as TrackedEntry;
    const nodes = [
      e(1017, "done", 11, 11), // closed itself
      e(1074, "open", 12, 32),
      e(5, "open", 14, 14), // open, but nothing left under it
      e(9, "open", 0, 0), // open leaf: still work to do
      e(7, "in_progress", 3, 4),
    ];
    expect(nodes.map(isFinished)).toEqual([true, false, true, false, false]);
    expect(sortTracked(nodes).map((n) => n.node.id)).toEqual([1074, 9, 7, 1017, 5]);
    expect(nodes.map((n) => n.node.id)).toEqual([1017, 1074, 5, 9, 7]);
  });
});
