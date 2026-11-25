import { describe, expect, it } from "vitest";
import { buildReplay, changes, describeStep, stateAt, stepsOf, storeAt, touched } from "./replay";
import { knownChildren } from "./treeStore";
import type { HistoryEvent, HistoryResponse, Status, ViewNode } from "./types";

function node(id: number, parent: number | null, over: Partial<ViewNode> = {}): ViewNode {
  return {
    id,
    parent,
    kind: "task",
    ordered: false,
    title: `N${String(id)}`,
    status: "open",
    priority: null,
    effective_priority: null,
    focus: null,
    due: null,
    defer_until: null,
    deferred: false,
    claimed_by: null,
    claim_expires: null,
    stalled: false,
    waiting_on: null,
    answered: false,
    repeat: null,
    has_notes: false,
    unplanned: false,
    is_step: false,
    is_next: false,
    progress: null,
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
    touched_at: "2026-11-15T00:00:00Z",
    child_count: 0,
    descendant_count: 0,
    closed_child_count: 0,
    dropped_child_count: 0,
    children_loaded: true,
    ...over,
  };
}

let nextId = 1;
function ev(
  nodeId: number,
  type: string,
  minute: number,
  over: Partial<HistoryEvent> = {},
): HistoryEvent {
  return {
    id: nextId++,
    node: nodeId,
    at: `2026-11-15T10:${String(minute).padStart(2, "0")}:00Z`,
    agent: "opus",
    type,
    detail: null,
    from_parent: null,
    to_parent: null,
    from_status: null,
    to_status: null,
    ...over,
  };
}

function history(nodes: ViewNode[], events: HistoryEvent[], root = 1): HistoryResponse {
  return {
    rev: events.length,
    version: "0.4.0",
    time_zone: "UTC",
    today: "2026-11-23",
    root,
    path: [],
    node_limit: 5000,
    event_limit: 20000,
    truncated: false,
    nodes,
    events,
  };
}

const ALL = { done: true, dropped: true };

const status = (h: HistoryResponse, k: number, id: number): Status | undefined =>
  stateAt(buildReplay(h), k).get(id)?.status;

// Root 1; 2 and 3 under it; 4 created under 2 then moved under 3 and finished;
// 5 claimed then released; 6 created later.
function sample(): HistoryResponse {
  nextId = 1;
  const nodes = [
    node(1, null, { kind: "area", title: "To do" }),
    node(2, 1, { title: "Home" }),
    node(3, 1, { title: "Work" }),
    node(4, 3, { status: "done", title: "Ship it" }),
    node(5, 3),
    node(6, 2),
  ];
  const events = [
    ev(1, "created", 0, { agent: null }),
    ev(2, "created", 1),
    ev(3, "created", 1),
    ev(4, "created", 2),
    ev(5, "created", 3),
    ev(4, "moved", 4, { from_parent: 2, to_parent: 3 }),
    ev(5, "claimed", 5, { agent: "sonnet" }),
    ev(4, "status", 6, { from_status: "open", to_status: "done" }),
    ev(5, "released", 7, { agent: "sonnet" }),
    ev(6, "created", 8),
  ];
  return history(nodes, events);
}

describe("stepsOf", () => {
  it("groups events written at the same instant by the same agent", () => {
    const steps = stepsOf(sample().events);
    // 2 and 3 were created in one call.
    expect(steps.map((s) => s.end - s.start)).toEqual([1, 2, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("replay", () => {
  it("starts with only nodes that predate their history (the root here)", () => {
    const r = buildReplay(sample());
    const s = storeAt(r, 0, ALL);
    expect([...s.nodes.keys()]).toEqual([1]);
  });

  it("puts a moved node under its original parent first", () => {
    const r = buildReplay(sample());
    // After step 3 (4 created) 4 sits under 2.
    const s = storeAt(r, 3, ALL);
    expect(knownChildren(s, 2)).toEqual([4]);
    // After the move step it sits under 3.
    const after = storeAt(r, 5, ALL);
    expect(knownChildren(after, 2)).toEqual([]);
    expect(knownChildren(after, 3)).toEqual([4, 5]);
  });

  it("replays claims, releases and status changes", () => {
    const h = sample();
    const r = buildReplay(h);
    expect(stateAt(r, 6).get(5)).toMatchObject({ status: "in_progress", claimedBy: "sonnet" });
    expect(status(h, 7, 4)).toBe("done");
    expect(stateAt(r, 8).get(5)).toMatchObject({ status: "open", claimedBy: null });
  });

  it("ends on the tree as it is now", () => {
    const h = sample();
    const r = buildReplay(h);
    const end = storeAt(r, r.steps.length, ALL);
    for (const n of h.nodes) {
      const got = end.nodes.get(n.id);
      expect(got?.parent).toBe(n.parent);
      expect(got?.status).toBe(n.status);
    }
    expect(end.nodes.get(1)?.descendant_count).toBe(5);
  });

  it("shows done and dropped nodes (with what is under them) only when asked, like the live view", () => {
    // Add 7 under 3 (then dropped) with a child 8, as the live view would see them.
    const h = sample();
    h.nodes.push(node(7, 3, { status: "dropped", title: "Never mind" }), node(8, 7));
    h.events.push(
      ev(7, "created", 9),
      ev(8, "created", 10),
      ev(7, "status", 11, { from_status: "open", to_status: "dropped" }),
    );
    const r = buildReplay(h);
    const last = r.steps.length;

    // Neither: only the open nodes (4 is done, 7 dropped, 8 hangs under 7).
    const open = storeAt(r, last, { done: false, dropped: false });
    expect(knownChildren(open, 3)).toEqual([5]);
    expect(open.nodes.has(4) || open.nodes.has(7) || open.nodes.has(8)).toBe(false);
    expect(open.nodes.get(3)?.dropped_child_count).toBe(1);
    expect(open.nodes.get(3)?.closed_child_count).toBe(2);
    expect(open.nodes.get(1)?.descendant_count).toBe(4);

    // Done only: 4 appears, 7 and 8 stay out.
    const done = storeAt(r, last, { done: true, dropped: false });
    expect(knownChildren(done, 3)).toEqual([4, 5]);
    expect(done.nodes.get(4)?.status).toBe("done");
    expect(done.nodes.has(7) || done.nodes.has(8)).toBe(false);

    // Dropped only: 7 and its child appear, 4 stays out.
    const dropped = storeAt(r, last, { done: false, dropped: true });
    expect(knownChildren(dropped, 3)).toEqual([5, 7]);
    expect(dropped.nodes.has(8)).toBe(true);
    expect(dropped.nodes.has(4)).toBe(false);

    const all = storeAt(r, last, ALL);
    expect(knownChildren(all, 3)).toEqual([4, 5, 7]);
    expect(all.nodes.get(1)?.descendant_count).toBe(7);
  });

  it("reports which nodes a step touched and what it did", () => {
    const r = buildReplay(sample());
    expect(touched(r, 2).sort()).toEqual([2, 3]);
    expect(describeStep(r, 2)).toBe("added 2, starting with “Home”");
    expect(describeStep(r, 5)).toBe("moved “Ship it” under “Work”");
    expect(describeStep(r, 7)).toBe("changed “Ship it” to done");
    expect(describeStep(r, 0)).toBe("");
  });

  it("says what each step changed, for the glow colour", () => {
    const r = buildReplay(sample());
    expect(changes(r, 2)).toEqual([
      { id: 2, change: "added" },
      { id: 3, change: "added" },
    ]);
    expect(changes(r, 5)).toEqual([{ id: 4, change: "moved" }]);
    expect(changes(r, 6)).toEqual([{ id: 5, change: "claimed" }]);
    expect(changes(r, 7)).toEqual([{ id: 4, change: "done" }]);
    expect(changes(r, 8)).toEqual([{ id: 5, change: "reopened" }]);
    expect(changes(r, 0)).toEqual([]);
  });

  it("reopens finished steps when a repeating task recurs", () => {
    nextId = 1;
    const h = history(
      [node(1, null), node(2, 1, { ordered: true }), node(3, 2)],
      [
        ev(1, "created", 0),
        ev(2, "created", 1),
        ev(3, "created", 1),
        ev(3, "status", 2, { from_status: "open", to_status: "done" }),
        ev(2, "status", 3, { from_status: "open", to_status: "done" }),
        ev(2, "recurred", 4, { from_status: "open", to_status: "open" }),
      ],
    );
    expect(status(h, 3, 3)).toBe("done");
    expect(status(h, 4, 3)).toBe("done");
    expect(status(h, 5, 2)).toBe("open");
    expect(status(h, 5, 3)).toBe("open");
  });

  it("replays a subtree whose root has its own created event", () => {
    nextId = 1;
    const h = history(
      [node(7, 1, { title: "Project" }), node(8, 7)],
      [
        ev(7, "created", 0),
        ev(7, "moved", 1, { from_parent: 2, to_parent: 1 }),
        ev(8, "created", 2),
      ],
      7,
    );
    const r = buildReplay(h);
    // The subtree's root is always drawn as the centre.
    expect([...storeAt(r, 0, ALL).nodes.keys()]).toEqual([7]);
    expect(knownChildren(storeAt(r, r.steps.length, ALL), 7)).toEqual([8]);
  });

  it("keeps a node moved in from outside hidden until it arrives", () => {
    nextId = 1;
    const h = history(
      [node(1, null), node(2, 1), node(9, 2)],
      [
        ev(2, "created", 0),
        ev(9, "created", 1),
        ev(9, "moved", 2, { from_parent: 40, to_parent: 2 }),
      ],
    );
    const r = buildReplay(h);
    expect(storeAt(r, 2, ALL).nodes.has(9)).toBe(false);
    expect(storeAt(r, 3, ALL).nodes.has(9)).toBe(true);
  });

  it("handles thousands of events quickly", () => {
    nextId = 1;
    const nodes = [node(1, null)];
    const events: HistoryEvent[] = [];
    for (let i = 2; i < 3000; i++) {
      nodes.push(node(i, Math.max(1, Math.floor(i / 4))));
      events.push(ev(i, "created", i % 60, { at: `2026-11-15T10:00:${String(i)}Z` }));
      events.push(ev(i, "claimed", i % 60, { at: `2026-11-15T11:00:${String(i)}Z` }));
    }
    const r = buildReplay(history(nodes, events));
    const t = performance.now();
    const s = storeAt(r, r.steps.length, ALL);
    expect(s.nodes.size).toBe(2999);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
