import { isClosed, REFINEMENT_LABEL, REFINEMENTS, refinementOf, STATUS_LABEL } from "./format";
import type { Crumb, Shown, Status, TreeResponse, ViewNode } from "./types";
import { NODE_PARAM, withShown } from "./urlState";

/** URL parameter that turns the page into a kanban board of one node's descendants. */
export const KANBAN_PARAM = "kanban";

/** URL parameter that picks what the board's columns are. */
export const GROUP_PARAM = "group";

/** What the board's columns stand for. */
export type Grouping = "status" | "refinement";

/** The grouping from a query string: refinement only for `group=refinement`, status otherwise. */
export function groupingFrom(search: string): Grouping {
  return new URLSearchParams(search).get(GROUP_PARAM) === "refinement" ? "refinement" : "status";
}

/** The page that shows `id`'s descendants on `server` as a kanban board. */
export function kanbanUrl(server: string, id: number, group?: Grouping, show?: Shown): string {
  const q = new URLSearchParams({ server, [KANBAN_PARAM]: String(id) });
  if (group === "refinement") q.set(GROUP_PARAM, "refinement");
  if (show) withShown(q, show);
  return `/?${q.toString()}`;
}

/** The tree page on `server`, centred on node `id` (the root, or no id, is the plain tree). */
export function treeUrl(server: string, id?: number): string {
  const q = new URLSearchParams({ server });
  if (id !== undefined && id !== 1) q.set(NODE_PARAM, String(id));
  return `/?${q.toString()}`;
}

/** The board's root id from a query string, or null when the page is the graph. */
export function kanbanRootFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get(KANBAN_PARAM);
  if (raw === null) return null;
  const id = Number(raw.replace(/^SPOKE-/i, ""));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export interface Card {
  node: ViewNode;
  /** Titles from the board's root (exclusive) down to the card's parent (inclusive). */
  path: Crumb[];
}

export interface Column {
  /** A status, a refinement, or "none" for nodes without a refinement. */
  key: string;
  label: string;
  cards: Card[];
}

const OPEN_COLUMNS: readonly Status[] = ["open", "in_progress", "waiting"];
const CLOSED_COLUMNS: readonly Status[] = ["done", "dropped"];

/** Columns shown, left to right. */
export function columnsFor(show: Shown): readonly Status[] {
  return [
    ...OPEN_COLUMNS,
    ...CLOSED_COLUMNS.filter((s) => (s === "done" ? show.done : show.dropped)),
  ];
}

/** No value sorts after every value. */
function nullsLast(a: number | string | null, b: number | string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Most pressing first: priority, focus rank, due date, then oldest id. */
export function compareCards(a: Card, b: Card): number {
  return compareNodes(a.node, b.node);
}

/** Most pressing first: priority, focus rank, due date, then oldest id. */
export function compareNodes(x: ViewNode, y: ViewNode): number {
  return (
    nullsLast(x.effective_priority, y.effective_priority) ||
    nullsLast(x.focus, y.focus) ||
    nullsLast(x.due, y.due) ||
    x.id - y.id
  );
}

/**
 * Every task beneath the slice's root, in one column per status or refinement, each with
 * its path below the root so a flattened card still says where it lives. Areas are never
 * cards, since they never finish; they only appear in the paths of the tasks under them.
 */
export function buildBoard(slice: TreeResponse, show: Shown, group: Grouping = "status"): Column[] {
  const byId = new Map(slice.nodes.map((n) => [n.id, n]));
  /** The path below the root, or null when `n` is not beneath the root. */
  const pathOf = (n: ViewNode): Crumb[] | null => {
    const out: Crumb[] = [];
    const seen = new Set<number>();
    let cur = n.parent;
    while (cur !== slice.root) {
      if (cur === null || seen.has(cur)) return null;
      seen.add(cur);
      const p = byId.get(cur);
      if (!p) return null;
      out.push({ id: p.id, title: p.title });
      cur = p.parent;
    }
    return out.reverse();
  };
  const columns: Column[] =
    group === "refinement"
      ? [
          ...REFINEMENTS.map((s) => ({ key: s, label: REFINEMENT_LABEL[s], cards: [] as Card[] })),
          { key: "none", label: "No refinement", cards: [] as Card[] },
        ]
      : columnsFor(show).map((s) => ({
          key: s,
          label: STATUS_LABEL[s],
          cards: [] as Card[],
        }));
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const keyOf = (n: ViewNode): string =>
    group === "refinement" ? (refinementOf(n) ?? "none") : n.status;
  for (const n of slice.nodes) {
    if (n.id === slice.root || n.kind === "area") continue;
    // Closed work has no refinement, so that board leaves it out.
    if (group === "refinement" && isClosed(n)) continue;
    const path = pathOf(n);
    if (path) byKey.get(keyOf(n))?.cards.push({ node: n, path });
  }
  for (const c of columns) c.cards.sort(compareCards);
  return columns;
}
