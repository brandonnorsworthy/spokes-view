import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import type { Layout, NodePos } from "./layout";
import { clip, isAlert, markers, spokeId, STATUS_LABEL, isEpic } from "./format";
import { easeInOut, focusTarget, interpolateView, labelFlip } from "./focus";
import type { View } from "./focus";
import type { Store } from "./treeStore";
import { missingChildren, needsFetch } from "./treeStore";
import type { ViewNode } from "./types";
import { glyphScale, onScreenGrowth } from "./zoomScale";

const MIN_K = 0.01;
const MAX_K = 4;
/** Label font size on screen, px. */
const FONT = 13.5;
/** How long a click-to-focus animation runs, ms. */
const FOCUS_MS = 450;
/** Zoom levels are bucketed so labels re-render only when the zoom moves a step. */
const LOD_STEP = 1.2;

function bucket(k: number): number {
  return Math.pow(LOD_STEP, Math.round(Math.log(k) / Math.log(LOD_STEP)));
}

/** A change to light up: the node, a class naming the kind of change, and its step. */
export interface Glow {
  id: number;
  change: string;
  step: number;
}

export interface GraphProps {
  layout: Layout;
  store: Store;
  expanded: ReadonlySet<number>;
  loading: ReadonlySet<number>;
  selected: number | null;
  /** Changes when the view should be fitted to the tree (a new server). */
  fitKey: number;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  /** Nodes to glow, with the branch down to them (replay: what recent steps changed). */
  highlight?: readonly Glow[];
  /** Refit when the tree grows or shrinks a lot, until the user pans or zooms (replay). */
  follow?: boolean;
  /** Blur the glows for a real glow (costly: replay turns it off at higher speeds). */
  softGlow?: boolean;
  /** Screen pixels at the top covered by something floating (the replay bar). */
  topInset?: number;
  /** Centre the view on `id` once it is laid out; a new `key` asks again (search). */
  focusOn?: { id: number; key: number } | null;
  /** Right-click (or the menu key) on a node, at a point in viewport pixels. */
  onMenu: (id: number, x: number, y: number) => void;
}

export function Graph(props: GraphProps): ReactElement {
  const {
    layout,
    store,
    expanded,
    loading,
    selected,
    fitKey,
    onSelect,
    onToggle,
    highlight,
    onMenu,
  } = props;
  const follow = props.follow ?? false;
  const topInset = props.topInset ?? 0;
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1, r: 0 });
  const [lod, setLod] = useState(1);
  /** The committed rotation: labels are laid out for it. */
  const [rot, setRot] = useState(0);
  /** Animation frame of a running click-to-focus, 0 when none. */
  const focusFrame = useRef(0);
  const frame = useRef(0);
  const dragged = useRef(false);

  /** The view last written into the SVG; while a gesture runs, `view` moves ahead of it. */
  const committed = useRef<View>({ x: 0, y: 0, k: 1, r: 0 });
  const idle = useRef(0);

  // Writes the view into the SVG and re-buckets the zoom (labels may change).
  const commit = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = 0;
    const v = view.current;
    committed.current = v;
    const svg = svgRef.current;
    viewportRef.current?.setAttribute(
      "transform",
      `translate(${v.x} ${v.y}) rotate(${v.r}) scale(${v.k})`,
    );
    if (svg) svg.style.transform = "";
    const b = bucket(v.k);
    setLod((old) => (old === b ? old : b));
    setRot((old) => (old === v.r ? old : v.r));
  }, []);

  // Moves the composited SVG layer to show `view` relative to the committed view.
  const paint = useCallback(() => {
    const v = view.current;
    const c = committed.current;
    const s = v.k / c.k;
    const svg = svgRef.current;
    if (svg) {
      svg.style.transform = `translate(${v.x}px, ${v.y}px) rotate(${v.r - c.r}deg) scale(${s}) translate(${-c.x}px, ${-c.y}px)`;
    }
  }, []);

  // During a pan or zoom only the composited SVG layer moves (a CSS transform relative
  // to the committed view), so a frame costs the same with ten nodes or ten thousand.
  // The real transform is written once the gesture has been idle for a moment.
  const apply = useCallback(
    (now = false) => {
      if (now) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        commit();
        return;
      }
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          paint();
        });
      }
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(commit, 160);
    },
    [commit, paint],
  );

  // Stops a click-to-focus where it is (the user took over the view).
  const stopFocus = useCallback(() => {
    if (!focusFrame.current) return;
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = 0;
    apply();
  }, [apply]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(focusFrame.current);
      window.clearTimeout(idle.current);
    },
    [],
  );

  /** The user panned or zoomed since the last fit: following stops until the next fit. */
  const userMoved = useRef(false);
  /** The node last focused, and where the layout had it; kept centred until the view is moved. */
  const pinned = useRef<{ id: number; x: number; y: number } | null>(null);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      userMoved.current = true;
      pinned.current = null;
      stopFocus();
      const v = view.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const f = k / v.k;
      view.current = { k, r: v.r, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
      apply();
    },
    [apply, stopFocus],
  );

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    stopFocus();
    const w = svg.clientWidth || 800;
    const top = Math.min(topInset, (svg.clientHeight || 600) / 2);
    const h = (svg.clientHeight || 600) - top;
    const b = layout.bounds;
    // Leave room, in screen pixels, for the outermost labels (their size is fixed on screen).
    const padX = Math.min(260, w * 0.2);
    const padY = Math.min(230, h * 0.25);
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const k = Math.min(
      MAX_K,
      Math.max(MIN_K, Math.min((w - 2 * padX) / bw, (h - 2 * padY) / bh, 1.4)),
    );
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // Fitting also turns the tree back north-up.
    view.current = { k, r: 0, x: w / 2 - cx * k, y: top + h / 2 - cy * k };
    userMoved.current = false;
    pinned.current = null;
    apply(true);
  }, [layout, apply, topInset, stopFocus]);

  // Click-to-focus: turn the tree so the node's label reads horizontally, glide the node
  // to the centre and zoom in. Frames use the composited fast path; the end commits.
  const focusNode = useCallback(
    (id: number) => {
      const p = layout.byId.get(id);
      const svg = svgRef.current;
      if (!p || !svg) return;
      cancelAnimationFrame(focusFrame.current);
      userMoved.current = true;
      pinned.current = { id, x: p.x, y: p.y };
      const from = view.current;
      // The target is worked out each frame from the graph's current size: selecting the
      // node opens the detail panel, which narrows the graph after this click.
      const target = () =>
        focusTarget(from, p, { x: (svg.clientWidth || 800) / 2, y: (svg.clientHeight || 600) / 2 });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = reduce ? 1 : Math.min(1, (now - t0) / FOCUS_MS);
        const to = target();
        view.current = t < 1 ? interpolateView(from, to, p, easeInOut(t)) : to;
        if (t < 1) {
          paint();
          focusFrame.current = requestAnimationFrame(step);
        } else {
          focusFrame.current = 0;
          apply(true);
        }
      };
      focusFrame.current = requestAnimationFrame(step);
    },
    [layout, apply, paint],
  );

  // Fit on a new server's first layout; later layouts (refresh, expand) keep the view.
  const fitted = useRef(-1);
  useLayoutEffect(() => {
    if (fitted.current !== fitKey && layout.nodes.length > 0) {
      fitted.current = fitKey;
      fit();
    }
  }, [fitKey, layout, fit]);

  // Centring on a node found by search, once it is drawn (its branch may still be loading).
  const focused = useRef(-1);
  const focusOn = props.focusOn ?? null;
  useLayoutEffect(() => {
    if (!focusOn || focused.current === focusOn.key) return;
    const p = layout.byId.get(focusOn.id);
    const svg = svgRef.current;
    if (!p || !svg) return;
    focused.current = focusOn.key;
    focusNode(focusOn.id);
  }, [focusOn, layout, focusNode]);

  // Expanding or collapsing moves nodes: bring the focused one back to the centre.
  useLayoutEffect(() => {
    const pin = pinned.current;
    if (!pin) return;
    const p = layout.byId.get(pin.id);
    if (!p) pinned.current = null;
    else if (p.x !== pin.x || p.y !== pin.y) focusNode(pin.id);
  }, [layout, focusNode]);

  // Following a growing tree: refit once it is a good deal larger than at the last fit.
  const fittedSize = useRef({ key: -1, size: 0 });
  useLayoutEffect(() => {
    const b = layout.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
    if (fitted.current !== fitKey) return;
    // A fresh fit (or not following) sets the reference size.
    if (fittedSize.current.key !== fitKey || !follow || userMoved.current) {
      fittedSize.current = { key: fitKey, size };
      return;
    }
    // Grown well past the last fit, or shrunk a lot (stepping back): refit.
    if (size > fittedSize.current.size * 1.25 || size < fittedSize.current.size * 0.5) {
      fittedSize.current = { key: fitKey, size };
      fit();
    }
  }, [layout, follow, fitKey, fit]);

  // Wheel and pinch zoom, drag to pan. Listeners are native so wheel can preventDefault.
  useEffect(() => {
    // Listen on the container: the SVG itself moves during a gesture.
    const svg = boxRef.current;
    if (!svg) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { d: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-delta * 0.0015), p.x, p.y);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointers.set(e.pointerId, local(e));
      start = local(e);
      dragged.current = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (a && b) pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > 4 && !dragged.current) {
        dragged.current = true;
        userMoved.current = true;
        pinned.current = null;
        stopFocus();
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // The pointer is already gone; the drag still works without capture.
        }
        svg.classList.add("dragging");
      }
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.d = d;
        dragged.current = true;
        return;
      }
      if (dragged.current) {
        view.current = {
          ...view.current,
          x: view.current.x + p.x - prev.x,
          y: view.current.y + p.y - prev.y,
        };
        apply();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        start = null;
        svg.classList.remove("dragging");
        if (dragged.current) apply(true);
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    };
  }, [zoomAt, apply, stopFocus]);

  const idFrom = (target: EventTarget | null): number | null => {
    const el = (target as Element | null)?.closest("[data-id]");
    const id = el ? Number(el.getAttribute("data-id")) : NaN;
    return Number.isFinite(id) ? id : null;
  };

  const onClick = (e: MouseEvent) => {
    if (dragged.current) return;
    const toggle = (e.target as Element).closest("[data-toggle]");
    const id = idFrom(e.target);
    if (id === null) return;
    if (toggle) {
      onToggle(id);
    } else {
      onSelect(id);
      focusNode(id);
    }
  };
  const onDoubleClick = (e: MouseEvent) => {
    const id = idFrom(e.target);
    if (id !== null) onToggle(id);
  };
  const onContextMenu = (e: MouseEvent) => {
    const id = idFrom(e.target);
    if (id === null) return;
    e.preventDefault();
    onMenu(id, e.clientX, e.clientY);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const id = idFrom(e.target);
    if (id === null) return;
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const r = (e.target as Element).getBoundingClientRect();
      onMenu(id, r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect(id);
    } else if (e.key === " " || e.key === "+" || e.key === "-") {
      e.preventDefault();
      onToggle(id);
    }
  };

  const centre = () => {
    const svg = svgRef.current;
    return { x: (svg?.clientWidth ?? 800) / 2, y: (svg?.clientHeight ?? 600) / 2 };
  };

  const sel = selected !== null ? layout.byId.get(selected) : undefined;
  const selPath = useMemo(() => {
    if (!sel) return "";
    let d = "";
    let cur: NodePos = sel;
    while (cur.parent !== null) {
      const p = layout.byId.get(cur.parent);
      if (!p) break;
      d += edgePath(p, cur);
      cur = p;
    }
    return d;
  }, [sel, layout]);

  return (
    <div className="graph" ref={boxRef}>
      <svg
        ref={svgRef}
        className="graph-svg"
        role="tree"
        aria-label="To-do tree. Drag to pan, scroll or pinch to zoom. Enter opens a node, Space expands or collapses it, right-click or the menu key shows more."
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <g ref={viewportRef}>
          <Rings radii={layout.radii} />
          <Edges layout={layout} />
          {highlight && highlight.length > 0 && (
            <Glows
              layout={layout}
              store={store}
              glows={highlight}
              k={lod}
              soft={props.softGlow ?? true}
            />
          )}
          {selPath && <path className="edge-selected" d={selPath} />}
          <Nodes
            layout={layout}
            store={store}
            expanded={expanded}
            loading={loading}
            k={lod}
            turn={rot}
          />
          {sel && (
            <circle
              className="selected-ring"
              cx={sel.x}
              cy={sel.y}
              r={nodeRadius(store.nodes.get(sel.id), sel) + 7}
            />
          )}
        </g>
      </svg>
      <div className="zoom-buttons" role="group" aria-label="Zoom">
        <button
          type="button"
          onClick={() => {
            const c = centre();
            zoomAt(1.4, c.x, c.y);
          }}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            const c = centre();
            zoomAt(1 / 1.4, c.x, c.y);
          }}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button type="button" onClick={fit} aria-label="Fit to view" title="Fit to view">
          ⤢
        </button>
      </div>
    </div>
  );
}

/**
 * An edge: a straight spoke from the root; deeper, out along the parent's angle to
 * halfway between the rings, around that circle to the child's angle, then out to the
 * child. Edges then stay between their two rings and never cut across the centre.
 */
const GLOW_COLOURS: Record<string, string> = {
  added: "var(--next)",
  done: "var(--done)",
  dropped: "var(--dropped)",
  claimed: "var(--in-progress)",
  waiting: "var(--waiting)",
  moved: "var(--accent)",
  reopened: "var(--p2)",
  edited: "var(--focus)",
  /** Not a replay change: the node a search jumped to. */
  found: "var(--accent)",
};

/**
 * Replay glows: each changed node gets a soft halo, and the branch from the root down to
 * it lights up, both fading out. Each glow is keyed by its step, so it plays once and a
 * newer step does not cut an older one short.
 */
function Glows({
  layout,
  store,
  glows,
  k,
  soft,
}: {
  layout: Layout;
  store: Store;
  glows: readonly Glow[];
  k: number;
  soft: boolean;
}): ReactElement {
  // The halo keeps at least this size on screen (px), however far out the view is.
  const minHalo = 34 / k;
  // The newest step stays marked (a steady ring and branch) until the next one.
  const latest = glows.reduce((m, g) => Math.max(m, g.step), 0);
  const b = layout.bounds;
  // Room around the tree for halos and blur, in layout units.
  const pad = 120 / k;
  return (
    <g className="glows" aria-hidden="true">
      <defs>
        {/* A real glow: the layer blurred at two radii (in screen pixels, so it looks the
            same at any zoom) under the sharp strokes. The region is in user space because
            a straight branch has a zero-height box, which would clip a box-relative one. */}
        <filter
          id="glow-blur"
          filterUnits="userSpaceOnUse"
          x={b.minX - pad}
          y={b.minY - pad}
          width={b.maxX - b.minX + 2 * pad}
          height={b.maxY - b.minY + 2 * pad}
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={4 / k} result="near" />
          <feGaussianBlur in="SourceGraphic" stdDeviation={12 / k} result="far" />
          <feMerge>
            <feMergeNode in="far" />
            <feMergeNode in="near" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {Object.entries(GLOW_COLOURS).map(([change, colour]) => (
          <radialGradient key={change} id={`glow-${change}`}>
            <stop offset="0%" style={{ stopColor: colour, stopOpacity: 0.85 }} />
            <stop offset="45%" style={{ stopColor: colour, stopOpacity: 0.35 }} />
            <stop offset="100%" style={{ stopColor: colour, stopOpacity: 0 }} />
          </radialGradient>
        ))}
      </defs>
      <g filter={soft ? "url(#glow-blur)" : undefined}>
        {glows.map((g) => {
          const p = layout.byId.get(g.id);
          if (!p) return null;
          let d = "";
          let cur: NodePos = p;
          while (cur.parent !== null) {
            const up = layout.byId.get(cur.parent);
            if (!up) break;
            d += edgePath(up, cur);
            cur = up;
          }
          const colour = GLOW_COLOURS[g.change] ?? "var(--focus)";
          const nr = nodeRadius(store.nodes.get(g.id), p);
          const r = Math.max(nr + 18, minHalo);
          return (
            <g key={`${String(g.step)}-${String(g.id)}`} className="glow" style={{ color: colour }}>
              {d && <path className="glow-branch-halo" d={d} />}
              {d && <path className="glow-branch-wide" d={d} />}
              {d && <path className="glow-branch" d={d} />}
              <circle
                className="glow-halo"
                cx={p.x}
                cy={p.y}
                r={r}
                fill={`url(#glow-${g.change in GLOW_COLOURS ? g.change : "edited"})`}
              />
              <circle className="glow-ring" cx={p.x} cy={p.y} r={r * 0.45} />
              {g.step === latest && (
                <>
                  {d && <path className="glow-steady-branch" d={d} />}
                  <circle className="glow-steady" cx={p.x} cy={p.y} r={Math.max(nr + 7, 12 / k)} />
                </>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}

export function edgePath(p: NodePos, c: NodePos): string {
  const f = (v: number) => v.toFixed(1);
  if (p.depth === 0) return `M${f(p.x)} ${f(p.y)}L${f(c.x)} ${f(c.y)}`;
  const rp = Math.hypot(p.x, p.y);
  const rc = Math.hypot(c.x, c.y);
  const rm = (rp + rc) / 2;
  const ax = rm * Math.sin(p.angle);
  const ay = -rm * Math.cos(p.angle);
  const bx = rm * Math.sin(c.angle);
  const by = -rm * Math.cos(c.angle);
  const delta = c.angle - p.angle;
  if (Math.abs(delta) < 1e-6) return `M${f(p.x)} ${f(p.y)}L${f(c.x)} ${f(c.y)}`;
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0;
  return `M${f(p.x)} ${f(p.y)}L${f(ax)} ${f(ay)}A${f(rm)} ${f(rm)} 0 ${large} ${sweep} ${f(bx)} ${f(by)}L${f(c.x)} ${f(c.y)}`;
}

function nodeRadius(n: ViewNode | undefined, p: NodePos): number {
  if (p.depth === 0) return 14;
  if (n?.kind === "area") return 9;
  return 6;
}

const Rings = memo(function Rings({ radii }: { radii: number[] }) {
  return (
    <g className="rings" aria-hidden="true">
      {radii.slice(1).map((r, i) => (
        <circle key={i} r={r} />
      ))}
    </g>
  );
});

const Edges = memo(function Edges({ layout }: { layout: Layout }) {
  // One path for every edge: a few thousand segments cost one DOM node.
  const d = useMemo(() => {
    const parts: string[] = [];
    for (const n of layout.nodes) {
      if (n.parent === null) continue;
      const p = layout.byId.get(n.parent);
      if (!p) continue;
      parts.push(edgePath(p, n));
    }
    return parts.join("");
  }, [layout]);
  return <path className="edges" d={d} aria-hidden="true" />;
});

interface NodesProps {
  layout: Layout;
  store: Store;
  expanded: ReadonlySet<number>;
  loading: ReadonlySet<number>;
  /** Zoom bucket: decides which labels show and how long they may be. */
  k: number;
  /** The tree's rotation, degrees: labels are turned to stay readable under it. */
  turn: number;
}

/** An epic's glyph is a hexagon, clearly larger than a task's circle. */
const EPIC_SCALE = 1.7;
function hexagon(r: number): string {
  const points = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3;
    return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

const Nodes = memo(function Nodes({ layout, store, expanded, loading, k, turn }: NodesProps) {
  const today = store.meta?.today ?? "";
  // Labels keep the same size on screen when zoomed out and grow gently with glyphs past 1x.
  const grow = onScreenGrowth(k);
  const font = (FONT * grow) / k;
  return (
    <g className="nodes">
      {layout.nodes.map((p) => {
        const n = store.nodes.get(p.id);
        if (!n) return null;
        // An epic is drawn larger, and its rings, toggle and label make room for it.
        const epic = isEpic(n) && p.depth > 0;
        const r = nodeRadius(n, p) * (epic ? EPIC_SCALE : 1);
        const hasKids = n.child_count > 0;
        const isOpen = expanded.has(n.id) && p.childCount > 0;
        const collapsed = hasKids && !isOpen;
        const busy = loading.has(n.id);
        const ms = markers(n, today);
        // A label shows when its wedge is tall enough on screen for one line of text.
        const showLabel = p.depth === 0 || p.room * k >= FONT * grow + 2;
        // An open inner node gets a short level label under it; a leaf or a collapsed node
        // a long one running outward (nothing else is drawn in its wedge beyond it).
        const outward = p.depth > 0 && p.childCount === 0;
        const maxChars = p.depth === 0 ? 40 : outward ? 36 : 22;
        const missing = missingChildren(store, n.id);
        const hidden = collapsed ? n.descendant_count : 0;
        const label = clip(n.title, maxChars);
        const describe = [
          isEpic(n) ? "epic" : n.kind,
          STATUS_LABEL[n.status],
          n.effective_priority ? `priority ${n.effective_priority}` : "",
          ...ms.map((m) => m.title),
          hidden ? `${hidden} hidden beneath` : "",
        ]
          .filter(Boolean)
          .join(", ");
        const prio = n.effective_priority;
        const squareTurn = `rotate(${((p.angle * 180) / Math.PI).toFixed(2)})`;
        const ownPrio = n.priority !== null;
        const deg = (p.angle * 180) / Math.PI - 90;
        const flip = labelFlip(p.angle, turn);
        const rot = flip ? deg + 180 : deg;
        // Zoomed out, glyphs grow back toward their on-screen size, but never wider than
        // the node's wedge, so a dense ring does not turn into a smear. Zoomed in they grow
        // in step with the labels.
        const z = glyphScale(k, p.room, r);
        const offset = (hasKids ? r + 20 : r + 6) * z;
        const cls = [
          "node",
          `s-${n.status}`,
          `k-${n.kind}`,
          isEpic(n) ? "epic" : "",
          p.depth === 0 ? "root" : "",
          n.deferred ? "deferred" : "",
          collapsed ? "collapsed" : "",
          n.is_next ? "is-next" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={n.id}
            className={cls}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            data-id={n.id}
            tabIndex={0}
            role="treeitem"
            aria-label={`${spokeId(n.id)} ${n.title}: ${describe}`}
            aria-expanded={hasKids ? isOpen : undefined}
          >
            <title>{`${spokeId(n.id)}  ${n.title}\n${describe}`}</title>
            <g transform={Math.abs(z - 1) < 1e-3 ? undefined : `scale(${z.toFixed(3)})`}>
              {prio !== null && p.depth > 0 && (
                <circle className={`prio p${prio} ${ownPrio ? "own" : "inherited"}`} r={r + 3.5} />
              )}
              {collapsed && <circle className="collapsed-halo" r={r + (prio ? 7 : 4)} />}
              {busy && <circle className="busy" r={r + 9} />}
              {epic ? (
                <path className="shape" d={hexagon(r)} transform={squareTurn} />
              ) : n.kind === "area" && p.depth > 0 ? (
                <rect
                  className="shape"
                  x={-r}
                  y={-r}
                  width={r * 2}
                  height={r * 2}
                  rx={3}
                  transform={squareTurn}
                />
              ) : (
                <circle className="shape" r={r} />
              )}
              {isAlert(n, today) && (
                <circle
                  className="alert-dot"
                  cx={r * 0.8}
                  cy={-r * 0.8}
                  r={3.2}
                  transform={n.kind === "area" && p.depth > 0 ? squareTurn : undefined}
                />
              )}
              {hasKids && p.depth > 0 && (
                <g
                  data-toggle="1"
                  className="toggle"
                  aria-hidden="true"
                  transform={`translate(${(Math.cos((deg * Math.PI) / 180) * (r + 10)).toFixed(1)} ${(Math.sin((deg * Math.PI) / 180) * (r + 10)).toFixed(1)})`}
                >
                  <circle r={6} className="toggle-bg" />
                  <path className="toggle-glyph" d={isOpen ? "M-3 0H3" : "M-3 0H3M0 -3V3"} />
                </g>
              )}
            </g>
            {showLabel &&
              (!outward ? (
                <text
                  className="label inner-label"
                  transform={turn ? `rotate(${(-turn).toFixed(2)})` : undefined}
                  y={r * z + font * (p.depth === 0 ? 1.4 : 1.25)}
                  fontSize={font}
                >
                  {label}
                  {ms.map((m) => (
                    <tspan key={m.key} className={`marker ${m.cls}`}>
                      {" " + m.glyph}
                    </tspan>
                  ))}
                </text>
              ) : (
                <text
                  className="label"
                  transform={`rotate(${rot.toFixed(2)})`}
                  x={flip ? -offset : offset}
                  dy="0.35em"
                  textAnchor={flip ? "end" : "start"}
                  fontSize={font}
                >
                  {label}
                  {ms.map((m) => (
                    <tspan key={m.key} className={`marker ${m.cls}`}>
                      {" " + m.glyph}
                    </tspan>
                  ))}
                  {hidden > 0 && <tspan className="hidden-count">{` +${hidden}`}</tspan>}
                  {missing > 0 && (
                    <tspan className="hidden-count">{` (+${missing} not loaded)`}</tspan>
                  )}
                  {busy && <tspan className="hidden-count"> loading…</tspan>}
                </text>
              ))}
            {needsFetch(store, n.id) && !busy && collapsed && <desc>children load on expand</desc>}
          </g>
        );
      })}
    </g>
  );
});
