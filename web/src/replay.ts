// Replay: rebuild a subtree as it stood after each step of its history.
//
// Spokes' `/api/history` gives every node in the subtree (current state, closed ones
// included) and every event on them, oldest first, with moves and status changes
// already parsed. A *step* is a run of events written at the same instant by the same
// agent (one tool call: a whole nested plan from one `add` appears as one step). The
// tree after step `k` is rebuilt by playing the first `k` steps over the starting state.
//
// What is replayed: which nodes exist, under which parent, their status, claim and
// open question. What is not (the event log does not keep old values): titles, notes,
// priority, dates and order among siblings, which show as they are now.

import type { Store } from "./treeStore";
import type { HistoryEvent, HistoryResponse, Shown, Status, ViewNode } from "./types";

export interface Step {
  /** Index of the step's first event in `history.events`. */
  start: number;
  /** One past its last event. */
  end: number;
  at: string;
  agent: string | null;
}

interface NodeState {
  present: boolean;
  parent: number | null;
  status: Status;
  claimedBy: string | null;
  waitingOn: string | null;
  answered: boolean;
}

export interface Replay {
  history: HistoryResponse;
  steps: Step[];
  /** The state before the first step. */
  initial: Map<number, NodeState>;
  byId: Map<number, ViewNode>;
  /** Sibling order: each node's index in the response's pre-order. */
  order: Map<number, number>;
}

const STATUSES: readonly Status[] = ["open", "in_progress", "waiting", "done", "dropped"];

function asStatus(s: string | null): Status | null {
  return STATUSES.find((x) => x === s) ?? null;
}

/** Groups events into steps: same instant and same agent. */
export function stepsOf(events: readonly HistoryEvent[]): Step[] {
  const steps: Step[] = [];
  let cur: Step | null = null;
  events.forEach((e, i) => {
    if (cur && cur.at === e.at && cur.agent === e.agent) {
      cur.end = i + 1;
    } else {
      cur = { start: i, end: i + 1, at: e.at, agent: e.agent };
      steps.push(cur);
    }
  });
  return steps;
}

export function buildReplay(history: HistoryResponse): Replay {
  const byId = new Map<number, ViewNode>();
  const order = new Map<number, number>();
  history.nodes.forEach((n, i) => {
    byId.set(n.id, n);
    order.set(n.id, i);
  });
  const firstMove = new Map<number, number>();
  const firstStatus = new Map<number, Status>();
  const created = new Set<number>();
  for (const e of history.events) {
    if (e.type === "created") created.add(e.node);
    if (e.type === "moved" && e.from_parent !== null && !firstMove.has(e.node))
      firstMove.set(e.node, e.from_parent);
    const from = asStatus(e.from_status);
    if (from && !firstStatus.has(e.node)) firstStatus.set(e.node, from);
  }
  const initial = new Map<number, NodeState>();
  for (const n of history.nodes) {
    const isRoot = n.id === history.root;
    // A node with a `created` event appears at that step, open. One without (made
    // before its history was kept) is there from the start, as its first known status.
    const hasCreated = created.has(n.id) && !isRoot;
    initial.set(n.id, {
      present: !hasCreated,
      parent: isRoot ? null : (firstMove.get(n.id) ?? n.parent),
      status: hasCreated ? "open" : (firstStatus.get(n.id) ?? n.status),
      claimedBy: null,
      waitingOn: null,
      answered: false,
    });
  }
  return { history, steps: stepsOf(history.events), initial, byId, order };
}

function apply(state: Map<number, NodeState>, e: HistoryEvent, children: () => ChildIndex) {
  const s = state.get(e.node);
  if (!s) return;
  switch (e.type) {
    case "created":
      s.present = true;
      s.status = "open";
      break;
    case "moved":
      // The subtree's root stays the root even if it moved elsewhere in the full tree.
      if (e.to_parent !== null && s.parent !== null) s.parent = e.to_parent;
      break;
    case "status": {
      const to = asStatus(e.to_status);
      if (to) {
        s.status = to;
        s.claimedBy = null;
        s.waitingOn = null;
        s.answered = false;
      }
      break;
    }
    case "claimed":
      s.status = "in_progress";
      s.claimedBy = e.agent;
      s.waitingOn = null;
      s.answered = false;
      break;
    case "released":
      s.status = "open";
      s.claimedBy = null;
      break;
    case "asked":
      s.status = "waiting";
      s.waitingOn = e.detail;
      break;
    case "answered":
      s.status = "open";
      s.waitingOn = null;
      s.answered = true;
      break;
    case "recurred": {
      s.status = "open";
      s.claimedBy = null;
      s.waitingOn = null;
      s.answered = false;
      // Its finished steps come back with it.
      const stack = [...(children().get(e.node) ?? [])];
      while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined) continue;
        const c = state.get(id);
        if (c?.status === "done") c.status = "open";
        stack.push(...(children().get(id) ?? []));
      }
      break;
    }
    default:
      // updated, focus and anything newer change nothing drawn.
      break;
  }
}

type ChildIndex = Map<number, number[]>;

function childIndex(state: Map<number, NodeState>, order: Map<number, number>): ChildIndex {
  const out: ChildIndex = new Map();
  for (const [id, s] of state) {
    if (!s.present || s.parent === null) continue;
    let list = out.get(s.parent);
    if (!list) out.set(s.parent, (list = []));
    list.push(id);
  }
  for (const list of out.values()) list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return out;
}

/** The node states after the first `k` steps. */
export function stateAt(r: Replay, k: number): Map<number, NodeState> {
  const state = new Map<number, NodeState>();
  for (const [id, s] of r.initial) state.set(id, { ...s });
  const last = r.steps[Math.min(k, r.steps.length) - 1];
  const end = k <= 0 || !last ? 0 : last.end;
  for (let i = 0; i < end; i++) {
    const e = r.history.events[i];
    if (!e) continue;
    let cache: ChildIndex | null = null;
    apply(state, e, () => (cache ??= childIndex(state, r.order)));
  }
  return state;
}

const CLOSED: ReadonlySet<Status> = new Set(["done", "dropped"]);

/**
 * A store holding the subtree as it stood after `k` steps, in the same shape the live
 * view draws: every node reachable from the subtree's root, all children loaded.
 * Done nodes are left out (with what is under them) unless `show.done`, and dropped ones
 * unless `show.dropped`, as in the live view.
 */
export function storeAt(r: Replay, k: number, show: Shown): Store {
  const state = stateAt(r, k);
  const kids = childIndex(state, r.order);
  const visible = (id: number) => {
    const s = state.get(id);
    return (
      !!s &&
      s.present &&
      (s.status === "done" ? show.done : s.status === "dropped" ? show.dropped : true)
    );
  };
  const store: Store = {
    nodes: new Map(),
    children: new Map(),
    complete: new Set(),
    meta: {
      rev: r.history.rev,
      version: r.history.version,
      time_zone: r.history.time_zone,
      today: r.history.today,
    },
    truncated: r.history.truncated,
  };
  const root = r.history.root;
  if (!visible(root)) return store;
  // Post-order counts over what is drawn.
  const walk = (id: number, seen: Set<number>): number => {
    seen.add(id);
    const base = r.byId.get(id);
    const s = state.get(id);
    if (!base || !s) return 0;
    const all = kids.get(id) ?? [];
    const shown = all.filter((c) => visible(c) && !seen.has(c));
    let descendants = 0;
    for (const c of shown) descendants += 1 + walk(c, seen);
    const live = all.filter((c) => state.get(c)?.status !== "dropped");
    store.nodes.set(id, {
      ...base,
      parent: id === root ? base.parent : s.parent,
      status: s.status,
      claimed_by: s.claimedBy,
      claim_expires: null,
      stalled: false,
      waiting_on: s.waitingOn,
      answered: s.answered,
      // Derived from the present, not replayed: leave them off.
      focus: null,
      deferred: false,
      is_next: false,
      progress:
        base.kind === "task" && live.length > 0
          ? {
              done: live.filter((c) => state.get(c)?.status === "done").length,
              total: live.length,
            }
          : null,
      child_count: shown.length,
      descendant_count: descendants,
      closed_child_count: all.filter((c) => CLOSED.has(state.get(c)?.status ?? "open")).length,
      dropped_child_count: all.filter((c) => state.get(c)?.status === "dropped").length,
      children_loaded: true,
    });
    store.children.set(id, shown);
    store.complete.add(id);
    return descendants;
  };
  walk(root, new Set());
  return store;
}

/** What a step did to a node, which decides the colour it glows in. */
export type Change =
  "added" | "done" | "dropped" | "claimed" | "waiting" | "moved" | "reopened" | "edited";

export const CHANGES: readonly { change: Change; label: string }[] = [
  { change: "added", label: "added" },
  { change: "done", label: "done" },
  { change: "claimed", label: "claimed" },
  { change: "waiting", label: "asked" },
  { change: "moved", label: "moved" },
  { change: "reopened", label: "reopened" },
  { change: "dropped", label: "dropped" },
  { change: "edited", label: "edited" },
];

function changeOf(e: HistoryEvent): Change {
  switch (e.type) {
    case "created":
      return "added";
    case "moved":
      return "moved";
    case "claimed":
      return "claimed";
    case "asked":
      return "waiting";
    case "released":
    case "answered":
    case "recurred":
      return "reopened";
    case "status":
      return e.to_status === "done"
        ? "done"
        : e.to_status === "dropped"
          ? "dropped"
          : e.to_status === "in_progress"
            ? "claimed"
            : e.to_status === "waiting"
              ? "waiting"
              : "reopened";
    default:
      return "edited";
  }
}

/** The nodes step `k` (1-based) changed and how; a node's last event in the step wins. */
export function changes(r: Replay, k: number): { id: number; change: Change }[] {
  const step = r.steps[k - 1];
  if (!step) return [];
  const out = new Map<number, Change>();
  for (let i = step.start; i < step.end; i++) {
    const e = r.history.events[i];
    if (e) out.set(e.node, changeOf(e));
  }
  return [...out].map(([id, change]) => ({ id, change }));
}

/** Nodes an event in step `k` (1-based: the step just played) touched. */
export function touched(r: Replay, k: number): number[] {
  const step = r.steps[k - 1];
  if (!step) return [];
  const ids = new Set<number>();
  for (let i = step.start; i < step.end; i++) {
    const e = r.history.events[i];
    if (e) ids.add(e.node);
  }
  return [...ids];
}

const VERB: Record<string, string> = {
  created: "added",
  moved: "moved",
  status: "changed",
  claimed: "claimed",
  released: "released",
  asked: "asked about",
  answered: "answered",
  recurred: "repeated",
  updated: "edited",
  focus: "refocused",
};

/** One line saying what step `k` (1-based) did, e.g. `added 9: Release, Deploy, …`. */
export function describeStep(r: Replay, k: number): string {
  const step = r.steps[k - 1];
  if (!step) return "";
  const groups = new Map<string, HistoryEvent[]>();
  for (let i = step.start; i < step.end; i++) {
    const e = r.history.events[i];
    if (!e) continue;
    const g = groups.get(e.type);
    if (g) g.push(e);
    else groups.set(e.type, [e]);
  }
  const parts: string[] = [];
  for (const [type, events] of groups) {
    const verb = VERB[type] ?? type;
    const first = events[0];
    if (!first) continue;
    const title = r.byId.get(first.node)?.title ?? `SPOKE-${String(first.node)}`;
    if (events.length > 1) {
      parts.push(`${verb} ${String(events.length)}, starting with “${title}”`);
    } else if (type === "status" && first.to_status) {
      parts.push(`${verb} “${title}” to ${first.to_status.replace("_", " ")}`);
    } else if (type === "moved" && first.to_parent !== null) {
      const to = r.byId.get(first.to_parent)?.title ?? `SPOKE-${String(first.to_parent)}`;
      parts.push(`${verb} “${title}” under “${to}”`);
    } else {
      parts.push(`${verb} “${title}”`);
    }
  }
  return parts.join("; ");
}
