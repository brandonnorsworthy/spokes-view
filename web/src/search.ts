import type { SearchHit, SearchResponse, Shown } from "./types";

/**
 * The matched keywords worth showing under a hit: only when Spokes sent them, the hit is
 * not an ID hit, and it matched fewer keywords than were searched (a hit that matched
 * everything needs no explanation).
 */
export function matchedChips(hit: SearchHit, keywords: readonly string[]): string[] {
  const m = hit.matched;
  if (!m || hit.id_match === true) return [];
  if (m.length === 0 || m.length >= keywords.length) return [];
  return m;
}

/**
 * The keywords some listed result matched (in query order). A keyword no node has is not
 * "missing" from every hit, so it is left out of the comparison, as Spokes does.
 */
export function liveKeywords(data: SearchResponse): string[] {
  const seen = new Set(data.results.flatMap((r) => r.matched ?? []));
  return data.keywords.filter((k) => seen.has(k));
}

/** Where the next page starts: the page's own offset plus the results it holds. */
export function nextOffset(data: SearchResponse): number {
  return (data.offset ?? 0) + data.results.length;
}

/**
 * True when "More results" applies: Spokes 0.14.0+ (the response echoes `offset`) and
 * matches remain beyond what is listed. An older Spokes has no paging.
 */
export function hasMore(data: SearchResponse): boolean {
  return data.offset !== undefined && nextOffset(data) < data.total;
}

/** The list after appending the next page; `next` continues where `data` stops. */
export function mergePage(data: SearchResponse, next: SearchResponse): SearchResponse {
  const results = [...data.results, ...next.results];
  // An empty page means nothing more can be had, whatever `total` claims.
  const total = next.results.length === 0 ? (data.offset ?? 0) + results.length : next.total;
  return { ...data, results, total, hidden_closed: next.hidden_closed };
}

/**
 * The toggles to show a hit that the current ones hide: `hidden_by` names the boxes that
 * must be ticked. Returns null when nothing has to change.
 */
export function togglesForHit(hit: SearchHit, show: Shown): Shown | null {
  const by = hit.hidden_by ?? [];
  const next: Shown = {
    done: show.done || by.includes("done"),
    dropped: show.dropped || by.includes("dropped"),
  };
  return next.done === show.done && next.dropped === show.dropped ? null : next;
}
