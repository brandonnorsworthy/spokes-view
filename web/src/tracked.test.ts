import { describe, expect, it } from "vitest";
import { isTrackedPage, percentDone, trackedUrl } from "./tracked";

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
});
