import { describe, expect, it } from "vitest";
import {
  hasMore,
  liveKeywords,
  matchedChips,
  mergePage,
  nextOffset,
  togglesForHit,
} from "./search";
import type { SearchHit, SearchResponse } from "./types";

const base = {
  id: 7,
  title: "Watch a video",
  kind: "task",
  status: "open",
  effective_priority: null,
  focus: null,
  path: [],
  via: null,
};

// An older Spokes (0.5.0 to 0.10): none of the new fields.
const OLD = `{"rev":1,"query":"youtube","scope":1,"include_closed":false,"include_dropped":false,
"keywords":["youtube"],"total":12,"hidden_closed":0,"results":[${JSON.stringify(base)}]}`;

// Spokes 0.11.0+: every new field.
const NEW = `{"rev":1,"query":"youtube video","scope":1,"include_closed":false,"include_dropped":false,
"keywords":["youtube","video"],"total":3,"hidden_closed":0,"offset":0,"match":"any","results":[
${JSON.stringify({ ...base, matched: ["youtube"], id_match: false, hidden_by: [] })},
${JSON.stringify({ ...base, id: 8, matched: ["youtube", "video"], id_match: false, hidden_by: [] })},
${JSON.stringify({ ...base, id: 958, id_match: true, matched: ["958"], hidden_by: ["done"] })}]}`;

const old = JSON.parse(OLD) as SearchResponse;
const fresh = JSON.parse(NEW) as SearchResponse;

describe("response shapes", () => {
  it("reads an old response without the new fields", () => {
    expect(old.offset).toBeUndefined();
    expect(old.results[0]?.matched).toBeUndefined();
    expect(old.results[0]?.hidden_by).toBeUndefined();
    expect(hasMore(old)).toBe(false);
    expect(matchedChips(old.results[0] as SearchHit, old.keywords)).toEqual([]);
    expect(togglesForHit(old.results[0] as SearchHit, { done: false, dropped: false })).toBeNull();
  });
  it("reads a new response", () => {
    expect(fresh.offset).toBe(0);
    expect(fresh.match).toBe("any");
    expect(fresh.results[2]?.id_match).toBe(true);
  });
});

describe("matchedChips", () => {
  const [a, b, id] = fresh.results as [SearchHit, SearchHit, SearchHit];
  it("shows the keywords of a partial match", () => {
    expect(matchedChips(a, fresh.keywords)).toEqual(["youtube"]);
  });
  it("shows nothing when everything matched", () => {
    expect(matchedChips(b, fresh.keywords)).toEqual([]);
  });
  it("shows nothing for an id hit, even with fewer matched than keywords", () => {
    expect(matchedChips(id, ["958", "x"])).toEqual([]);
  });
  it("shows nothing when matched is empty", () => {
    expect(matchedChips({ ...a, matched: [] }, fresh.keywords)).toEqual([]);
  });
});

describe("paging", () => {
  it("has more only when offset is echoed and matches remain", () => {
    expect(hasMore({ ...fresh, total: 3 })).toBe(false);
    expect(hasMore({ ...fresh, total: 4 })).toBe(true);
    expect(hasMore({ ...old, total: 99 })).toBe(false);
    expect(hasMore({ ...fresh, offset: 10, total: 13 })).toBe(false);
  });
  it("asks for the next page after the results so far", () => {
    expect(nextOffset(fresh)).toBe(3);
    expect(nextOffset({ ...fresh, offset: 10 })).toBe(13);
  });
  it("appends a page and keeps going until the total", () => {
    const first = { ...fresh, total: 5 };
    const page = { ...fresh, offset: 3, total: 5, results: fresh.results.slice(0, 2) };
    const merged = mergePage(first, page);
    expect(merged.results).toHaveLength(5);
    expect(merged.offset).toBe(0);
    expect(hasMore(merged)).toBe(false);
  });
  it("stops on an empty page", () => {
    const merged = mergePage(
      { ...fresh, total: 9 },
      { ...fresh, offset: 3, total: 9, results: [] },
    );
    expect(hasMore(merged)).toBe(false);
  });
});

describe("togglesForHit", () => {
  const hit = (hidden_by: Array<"done" | "dropped">): SearchHit =>
    ({ ...base, hidden_by }) as SearchHit;
  const off = { done: false, dropped: false };
  it("changes nothing for a normal hit", () => {
    expect(togglesForHit(hit([]), off)).toBeNull();
  });
  it("turns on done", () => {
    expect(togglesForHit(hit(["done"]), off)).toEqual({ done: true, dropped: false });
  });
  it("turns on dropped and keeps done", () => {
    expect(togglesForHit(hit(["dropped"]), { done: true, dropped: false })).toEqual({
      done: true,
      dropped: true,
    });
  });
  it("turns on both", () => {
    expect(togglesForHit(hit(["done", "dropped"]), off)).toEqual({ done: true, dropped: true });
  });
  it("is null when the boxes are already on", () => {
    expect(togglesForHit(hit(["done"]), { done: true, dropped: false })).toBeNull();
  });
});

describe("liveKeywords", () => {
  it("drops keywords no listed result matched", () => {
    const data = {
      ...fresh,
      keywords: ["priority", "server", "box"],
      results: [
        { ...(fresh.results[0] as SearchHit), matched: ["server"] },
        { ...(fresh.results[1] as SearchHit), matched: ["box", "server"] },
      ],
    } as SearchResponse;
    expect(liveKeywords(data)).toEqual(["server", "box"]);
  });
  it("is empty for an old Spokes with no matched field", () => {
    const data = {
      ...fresh,
      results: fresh.results.map((r) => ({ ...r, matched: undefined })),
    } as SearchResponse;
    expect(liveKeywords(data)).toEqual([]);
  });
});
