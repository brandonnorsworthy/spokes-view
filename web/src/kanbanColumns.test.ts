import { describe, expect, it } from "vitest";
import { collapsedFrom, initialColumn, withCollapsed, type Column } from "./kanban";

const col = (key: string, n: number): Column => ({
  key,
  label: key,
  // Only the count matters here.
  cards: Array.from({ length: n }, () => ({}) as Column["cards"][number]),
});

describe("initialColumn", () => {
  const board = [col("open", 251), col("in_progress", 5), col("waiting", 2)];

  it("opens on In progress when it has cards, not the long Open column", () => {
    expect(initialColumn(board, null)).toBe("in_progress");
  });

  it("keeps the column the URL names", () => {
    expect(initialColumn(board, "waiting")).toBe("waiting");
  });

  it("ignores a column the board doesn't have", () => {
    expect(initialColumn(board, "done")).toBe("in_progress");
  });

  it("falls back to the first column with cards, then the first column", () => {
    expect(initialColumn([col("open", 0), col("in_progress", 0), col("waiting", 3)], null)).toBe(
      "waiting",
    );
    expect(initialColumn([col("open", 0), col("in_progress", 0)], null)).toBe("open");
    expect(initialColumn([], null)).toBeNull();
  });

  it("works for refinement columns too", () => {
    expect(initialColumn([col("none", 0), col("planned", 4)], null)).toBe("planned");
  });
});

describe("collapsed columns in the URL", () => {
  it("round-trips, sorted, and drops the parameter when empty", () => {
    const p = new URLSearchParams("server=Home&kanban=4");
    withCollapsed(p, new Set(["waiting", "open"]));
    expect(p.get("collapsed")).toBe("open,waiting");
    expect(collapsedFrom(`?${p.toString()}`)).toEqual(new Set(["open", "waiting"]));
    withCollapsed(p, new Set());
    expect(p.has("collapsed")).toBe(false);
  });

  it("ignores junk", () => {
    expect(collapsedFrom("?collapsed=open,<script>,,DONE")).toEqual(new Set(["open"]));
  });
});
