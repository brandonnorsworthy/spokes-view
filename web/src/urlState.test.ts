import { describe, expect, it } from "vitest";
import { backlogUrl } from "./backlog";
import { kanbanUrl } from "./kanban";
import { filterFrom, nodeFrom, shownFrom, withFilter, withShown } from "./urlState";

describe("shown in the URL", () => {
  it("round-trips and omits what is off", () => {
    const p = new URLSearchParams("server=Home");
    withShown(p, { done: true, dropped: false });
    expect(p.toString()).toBe("server=Home&done=1");
    expect(shownFrom(`?${p.toString()}`)).toEqual({ done: true, dropped: false });
    withShown(p, { done: false, dropped: true });
    expect(p.toString()).toBe("server=Home&dropped=1");
    withShown(p, { done: false, dropped: false });
    expect(p.toString()).toBe("server=Home");
  });
  it("treats anything but 1 as off", () => {
    expect(shownFrom("?done=yes&dropped=0")).toEqual({ done: false, dropped: false });
    expect(shownFrom("")).toEqual({ done: false, dropped: false });
  });
});

describe("backlog filter in the URL", () => {
  it("round-trips every field", () => {
    const f = { text: "mobile app", type: "feature", refinement: "none" } as const;
    const p = new URLSearchParams("server=Home&backlog=5");
    withFilter(p, f);
    expect(filterFrom(`?${p.toString()}`)).toEqual(f);
    expect(p.get("q")).toBe("mobile app");
  });
  it("omits empty text and any", () => {
    const p = new URLSearchParams("q=old&type=bug&ref=idea");
    withFilter(p, { text: "", type: "any", refinement: "any" });
    expect(p.toString()).toBe("");
  });
  it("falls back to the defaults on invalid values", () => {
    expect(filterFrom("?type=bogus&ref=nope")).toEqual({
      text: "",
      type: "any",
      refinement: "any",
    });
    expect(filterFrom("")).toEqual({ text: "", type: "any", refinement: "any" });
  });
});

describe("node in the URL", () => {
  it("reads ids and SPOKE-ids, rejects the rest", () => {
    expect(nodeFrom("?node=1017")).toBe(1017);
    expect(nodeFrom("?node=SPOKE-12")).toBe(12);
    expect(nodeFrom("?node=abc")).toBeNull();
    expect(nodeFrom("?node=-4")).toBeNull();
    expect(nodeFrom("?node=1.5")).toBeNull();
    expect(nodeFrom("?node=0")).toBeNull();
    expect(nodeFrom("")).toBeNull();
  });
});

describe("link builders", () => {
  it("keep their plain form without filters", () => {
    expect(kanbanUrl("Home", 5)).toBe("/?server=Home&kanban=5");
    expect(kanbanUrl("Home", 5, "refinement")).toBe("/?server=Home&kanban=5&group=refinement");
    expect(backlogUrl("Home", 5)).toBe("/?server=Home&backlog=5");
  });
  it("carry filters when given", () => {
    expect(kanbanUrl("Home", 5, "status", { done: true, dropped: true })).toBe(
      "/?server=Home&kanban=5&done=1&dropped=1",
    );
    expect(
      backlogUrl(
        "Home",
        5,
        { done: false, dropped: true },
        { text: "x", type: "bug", refinement: "any" },
      ),
    ).toBe("/?server=Home&backlog=5&dropped=1&q=x&type=bug");
  });
});
