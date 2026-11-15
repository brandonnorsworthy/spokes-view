import { describe, expect, it } from "vitest";
import { localizeTimes } from "./DetailPanel";
import { daysUntil, clip, formatInstant } from "./format";

describe("format", () => {
  it("counts days between calendar dates", () => {
    expect(daysUntil("2026-11-15", "2026-11-20")).toBe(5);
    expect(daysUntil("2026-11-15", "2026-11-14")).toBe(-1);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("clips long titles with an ellipsis", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("a much longer title", 8)).toBe("a much…");
  });

  it("shows UTC instants in the server's zone", () => {
    const local = formatInstant("2026-11-16T02:59:03Z", "America/Chicago");
    expect(local).toContain("8:59");
    expect(localizeTimes("until 2026-11-16T02:59:03Z", "America/Chicago")).toBe(`until ${local}`);
    expect(formatInstant("2026-11-16T02:59:03Z", "Not/AZone")).toContain("UTC");
  });
});
