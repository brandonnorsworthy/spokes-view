import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ApiError,
  fetchHistory,
  fetchNode,
  fetchTree,
  listServers,
  versionAtLeast,
  type TreeQuery,
} from "./api";
import { AppBar } from "./AppBar";
import { OptGroup, ServerPicker, Toggle } from "./ViewOptions";
import { DetailPanel, type DetailState } from "./DetailPanel";
import { clock, spokeId } from "./format";
import { Graph, type Glow, type MenuVia } from "./Graph";
import { linkActions, NodeActions } from "./NodeActions";
import { layoutRadial } from "./layout";
import { Legend } from "./Legend";
import { buildReplay, changes, describeStep, storeAt, type Replay } from "./replay";
import { ReplayBar, scopeLabel, type Speed } from "./ReplayBar";
import {
  ancestors,
  buildStore,
  closeOthers,
  fullExpansion,
  initialExpansion,
  knownChildren,
  needsFetch,
  revealStep,
  ROOT_ID,
} from "./treeStore";
import { Search } from "./Search";
import { togglesForHit } from "./search";
import { isolateFrom, nodeFrom, NODE_PARAM, replaceQuery, withIsolate } from "./urlState";
import { Icon } from "./Icon";
import type { SearchHit, ServerEntry, Shown, TreeResponse } from "./types";

/** Levels loaded on a server's first load, and per branch opened later. */
/** The default: only open, in-progress and waiting tasks are drawn. */
const NOTHING_CLOSED: Shown = { done: false, dropped: false };

const FIRST_DEPTH = 3;
const BRANCH_DEPTH = 2;
const REFRESH_MS = 30_000;
/** "Expand all": levels fetched per unloaded branch, and the most nodes it will draw. */
const EXPAND_ALL_DEPTH = 10;
const EXPAND_ALL_LIMIT = 3000;
const STORAGE_KEY = "spokes-view.server";
/** Time per replay step at 1×. */
const STEP_MS = 1200;
/** How long a change glows (keep in step with the glow animations in styles.css). */
const GLOW_MS = 2600;
/** Room the replay bar takes at the top of the graph, so a fit stays clear of it. */
const REPLAY_BAR_PX = 130;

type ReplayState =
  | { kind: "loading"; root: number }
  | { kind: "ready"; root: number; replay: Replay }
  | { kind: "error"; root: number; message: string };

/** One loaded slice: the query that fetched it, its tag and its body. */
interface Slice {
  q: TreeQuery;
  etag: string | null;
  data: TreeResponse;
}

type TreeState =
  { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "error"; error: ApiError };

function errorOf(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError("upstream_error", 0, String(e));
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function serverFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("server");
}

function rememberServer(name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Storage may be disabled; the URL still carries the choice.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("server") !== name) {
    url.searchParams.set("server", name);
    window.history.replaceState(null, "", url);
  }
}

const FULL_GLOW_KEY = "spokes-view.replay-full-glow";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Storage may be disabled; the setting then lasts for this page only.
  }
}

function storedServer(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Runs `tasks` with at most `limit` in flight; results in order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      if (task) out[i] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

export function App(): ReactElement {
  const [servers, setServers] = useState<ServerEntry[] | null>(null);
  const [serversError, setServersError] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const [show, setShow] = useState<Shown>(NOTHING_CLOSED);
  const [slices, setSlices] = useState<Slice[]>([]);
  const [tree, setTree] = useState<TreeState>({ kind: "idle" });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [changedAt, setChangedAt] = useState<Date | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandingAll, setExpandingAll] = useState(false);
  const [expandNote, setExpandNote] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [fullGlow, setFullGlow] = useState(() => readFlag(FULL_GLOW_KEY));
  /** The node search last jumped to: centred once, and glowing for a moment. */
  const [found, setFound] = useState<{ id: number; key: number } | null>(null);
  const [glowing, setGlowing] = useState(false);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number; via: MenuVia } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  /** The node the tree is laid out from (`isolate=<id>`), or null for the whole tree. */
  const [isolated, setIsolated] = useState<number | null>(() =>
    isolateFrom(window.location.search),
  );
  // The phone's search: the Search tab opens it over the tree (`search=1` opens it on load).
  const [searching, setSearching] = useState(
    () => new URLSearchParams(window.location.search).get("search") === "1",
  );

  // The latest values, for async work that outlives a render.
  const slicesRef = useRef(slices);
  const detailRef = useRef(detail);
  useLayoutEffect(() => {
    slicesRef.current = slices;
    detailRef.current = detail;
  }, [slices, detail]);
  /** Bumped on every server or dropped-toggle switch; stale responses are dropped. */
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const refreshBusy = useRef(false);
  const replayRef = useRef(replay);
  const isolatedRef = useRef(isolated);
  /** The server the page is on, so choosing another one can drop the isolation. */
  const serverRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    replayRef.current = replay;
    isolatedRef.current = isolated;
  }, [replay, isolated]);

  const store = useMemo(() => buildStore(slices.map((s) => s.data)), [slices]);

  // Load (or reload) a server. `keep` keeps expansion and selection (the dropped toggle).
  const load = useCallback(
    async (name: string, shown: Shown, keep: boolean): Promise<Slice[] | null> => {
      const gen = ++generation.current;
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const previous = keep ? slicesRef.current : [];
      if (!keep) {
        setReplay(null);
        setPlaying(false);
      }
      setTree({ kind: "loading" });
      setRefreshError(null);
      setExpandNote(null);
      if (!keep) {
        setSlices([]);
        setExpanded(new Set());
        setSelected(null);
        setDetail(null);
      }
      try {
        const first = await fetchTree(
          name,
          { root: ROOT_ID, depth: FIRST_DEPTH, show: shown },
          null,
          ctl.signal,
        );
        if (gen !== generation.current || !first.data) return null;
        const loaded: Slice[] = [
          {
            q: { root: ROOT_ID, depth: FIRST_DEPTH, show: shown },
            etag: first.etag,
            data: first.data,
          },
        ];
        // Reload the branches that were open, with the new dropped setting.
        const branches = previous.slice(1).map((s) => ({ ...s.q, show: shown }));
        const got = await pool(
          branches.map((q) => async () => {
            try {
              const r = await fetchTree(name, q, null, ctl.signal);
              return r.data ? { q, etag: r.etag, data: r.data } : null;
            } catch (e) {
              if (isAbort(e)) throw e;
              return null;
            }
          }),
          4,
        );
        if (gen !== generation.current) return null;
        for (const s of got) if (s) loaded.push(s);
        setSlices(loaded);
        if (!keep) {
          setExpanded(initialExpansion(buildStore(loaded.map((s) => s.data))));
          setFitKey((k) => k + 1);
        }
        setTree({ kind: "ready" });
        const now = new Date();
        setChangedAt(now);
        setCheckedAt(now);
        return loaded;
      } catch (e) {
        if (isAbort(e) || gen !== generation.current) return null;
        setTree({ kind: "error", error: errorOf(e) });
        return null;
      }
    },
    [],
  );

  // Picking a server loads it from scratch (done and dropped nodes hidden again).
  const choose = useCallback(
    (name: string) => {
      rememberServer(name);
      // Node ids belong to one server: another server starts from its whole tree.
      if (serverRef.current !== null && serverRef.current !== name) setIsolated(null);
      serverRef.current = name;
      setServer(name);
      setShow(NOTHING_CLOSED);
      void load(name, NOTHING_CLOSED, false);
    },
    [load],
  );

  // Server list, then the initial choice: URL, then the last one used, then the first.
  useEffect(() => {
    listServers()
      .then((list) => {
        setServers(list);
        const names = list.map((s) => s.name);
        const pick = (n: string | null) =>
          n ? names.find((x) => x.toLowerCase() === n.toLowerCase()) : undefined;
        const choice = pick(serverFromUrl()) ?? pick(storedServer()) ?? names[0];
        if (choice) choose(choice);
      })
      .catch((e: unknown) => {
        setServersError(errorOf(e).message);
      });
  }, [choose]);

  const toggleShown = (which: keyof Shown) => {
    const next = { ...show, [which]: !show[which] };
    setShow(next);
    if (server) void load(server, next, true);
  };

  // Detail: fetched on click, and again on refresh with its tag.
  const loadDetail = useCallback(
    async (name: string, id: number, shown: Shown, etag: string | null) => {
      const gen = generation.current;
      try {
        const r = await fetchNode(name, id, shown, etag);
        if (gen !== generation.current || detailRef.current?.id !== id) return;
        if (r.data) setDetail({ id, data: r.data, etag: r.etag, error: null, loading: false });
      } catch (e) {
        if (gen !== generation.current || detailRef.current?.id !== id) return;
        const err = errorOf(e);
        setDetail((d) =>
          d && d.id === id
            ? {
                ...d,
                loading: false,
                error:
                  err.code === "not_found"
                    ? "This node is no longer in the tree (closed, or moved out of view)."
                    : err.message,
              }
            : d,
        );
      }
    },
    [],
  );

  const select = useCallback(
    (id: number) => {
      if (!server) return;
      setSelected(id);
      setDetail({ id, data: null, etag: null, error: null, loading: true });
      // Open every ancestor so the node is drawn.
      const up = ancestors(store, id);
      if (up.length > 0) {
        setExpanded((ex) => {
          if (up.every((a) => ex.has(a))) return ex;
          const n = new Set(ex);
          for (const a of up) n.add(a);
          return n;
        });
      }
      void loadDetail(server, id, show, null);
    },
    [server, store, show, loadDetail],
  );

  /**
   * Opens `id`: loads its children if they are not loaded yet (or the node is not in the
   * store at all), then marks it expanded. Resolves false when the branch could not load.
   */
  const openBranch = useCallback(
    async (id: number): Promise<boolean> => {
      if (!server) return false;
      if (store.nodes.has(id) && !needsFetch(store, id)) {
        setExpanded((ex) => (ex.has(id) ? ex : new Set(ex).add(id)));
        return true;
      }
      if (loading.has(id)) return false;
      const gen = generation.current;
      setLoading((l) => new Set(l).add(id));
      const q = { root: id, depth: BRANCH_DEPTH, show };
      try {
        const r = await fetchTree(server, q, null);
        if (gen !== generation.current || !r.data) return false;
        const data = r.data;
        setSlices((s) => [...s.filter((x) => x.q.root !== id), { q, etag: r.etag, data }]);
        setExpanded((ex) => new Set(ex).add(id));
        return true;
      } catch (e) {
        if (gen === generation.current)
          setRefreshError(`Could not open SPOKE-${id}: ${errorOf(e).message}`);
        return false;
      } finally {
        setLoading((l) => {
          const n = new Set(l);
          n.delete(id);
          return n;
        });
      }
    },
    [server, store, loading, show],
  );

  const toggle = useCallback(
    async (id: number) => {
      if (!server) return;
      if (expanded.has(id) && knownChildren(store, id).length > 0) {
        setExpanded((ex) => {
          const n = new Set(ex);
          n.delete(id);
          return n;
        });
        return;
      }
      await openBranch(id);
    },
    [server, store, expanded, openBranch],
  );

  // ---- isolate ----
  const isolate = useCallback((id: number) => {
    if (id === ROOT_ID) return;
    setIsolated(id);
    setFitKey((k) => k + 1);
  }, []);
  const exitIsolate = useCallback(() => {
    setIsolated(null);
    setFitKey((k) => k + 1);
  }, []);

  // Keep `isolate=` in step with the state, so a reload keeps it.
  useEffect(() => {
    replaceQuery((p) => withIsolate(p, isolated));
  }, [isolated]);

  // Once the tree is ready, make sure the isolated node's children are loaded and open, and
  // fit the view to them. A node that cannot be loaded (bad id) ends the isolation.
  const preparedIso = useRef<number | null>(null);
  useEffect(() => {
    if (isolated === null) {
      preparedIso.current = null;
      return;
    }
    if (tree.kind !== "ready" || preparedIso.current === isolated) return;
    preparedIso.current = isolated;
    void openBranch(isolated).then((ok) => {
      if (isolatedRef.current !== isolated) return;
      if (ok) setFitKey((k) => k + 1);
      else setIsolated(null);
    });
  }, [isolated, tree.kind, openBranch]);

  // Jump to a search hit: load the branches down to it, open them, select and centre it.
  const shownNow = show;
  const reveal = useCallback(
    async (hit: Pick<SearchHit, "id" | "path">, over?: { show: Shown; slices: Slice[] }) => {
      if (!server) return;
      const gen = generation.current;
      const show = over?.show ?? shownNow;
      const chain = [...hit.path.map((c) => c.id), hit.id];
      let work = over?.slices ?? slicesRef.current;
      const tried = new Set<number>();
      try {
        for (;;) {
          const next = revealStep(buildStore(work.map((s) => s.data)), chain, tried);
          if (next.kind === "ready") break;
          if (next.kind === "blocked")
            throw new Error(`${spokeId(next.id)} is not in the tree as loaded (closed or moved?)`);
          const root = next.id;
          tried.add(root);
          setLoading((l) => new Set(l).add(root));
          const q = { root, depth: BRANCH_DEPTH, show };
          try {
            const r = await fetchTree(server, q, null);
            if (gen !== generation.current) return;
            if (!r.data) throw new Error("a branch did not load");
            const data = r.data;
            work = [...work.filter((s) => s.q.root !== root), { q, etag: r.etag, data }];
          } finally {
            setLoading((l) => {
              const n = new Set(l);
              n.delete(root);
              return n;
            });
          }
        }
        if (work !== slicesRef.current) setSlices(work);
        setExpanded((ex) => {
          const n = new Set(ex);
          for (const a of chain.slice(0, -1)) n.add(a);
          return n;
        });
        setSelected(hit.id);
        setDetail({ id: hit.id, data: null, etag: null, error: null, loading: true });
        void loadDetail(server, hit.id, show, null);
        setFound((f) => ({ id: hit.id, key: (f?.key ?? 0) + 1 }));
        setGlowing(true);
        setRefreshError(null);
      } catch (e) {
        if (gen === generation.current)
          setRefreshError(`Could not show ${spokeId(hit.id)}: ${errorOf(e).message}`);
      }
    },
    [server, shownNow, loadDetail],
  );

  // Picking a hit that "Show done" / "Show dropped" hide ticks those boxes first, reloads
  // the tree under them, and then jumps.
  const pickHit = useCallback(
    async (hit: Pick<SearchHit, "id" | "path" | "hidden_by">) => {
      // A pick outside the isolated branch leaves the isolation first.
      if (isolated !== null && ![...hit.path.map((c) => c.id), hit.id].includes(isolated))
        setIsolated(null);
      const next = togglesForHit(hit, show);
      if (!next || !server) {
        await reveal(hit);
        return;
      }
      setShow(next);
      const slices = await load(server, next, true);
      if (slices) await reveal(hit, { show: next, slices });
    },
    [server, show, isolated, load, reveal],
  );

  // `?node=<id>`: once the tree is ready, jump to that node as a search pick would. The node
  // is fetched with everything shown, so a done or dropped one still gives its path.
  const pendingNode = useRef<number | null>(nodeFrom(window.location.search));
  const nodeSync = useRef(pendingNode.current === null);
  useEffect(() => {
    const id = pendingNode.current;
    if (id === null || !server || tree.kind !== "ready") return;
    pendingNode.current = null;
    const done = (): void => {
      nodeSync.current = true;
    };
    fetchNode(server, id, { done: true, dropped: true }, null)
      .then(async (r) => {
        if (!r.data) throw new Error("no data");
        const status = r.data.node.status;
        const hidden_by: Array<"done" | "dropped"> =
          status === "done" || status === "dropped" ? [status] : [];
        await pickHit({ id, path: r.data.path, hidden_by });
      })
      .catch((e: unknown) => {
        const err = errorOf(e);
        setRefreshError(
          err.code === "not_found"
            ? `${spokeId(id)} is not in the tree.`
            : `Could not show ${spokeId(id)}: ${err.message}`,
        );
        replaceQuery((p) => p.delete(NODE_PARAM));
      })
      .finally(done);
  }, [server, tree.kind, pickHit]);

  // Keep `node=` in step with the selection, so a refresh keeps it.
  useEffect(() => {
    if (!nodeSync.current) return;
    replaceQuery((p) => {
      if (selected !== null && selected !== ROOT_ID) p.set(NODE_PARAM, String(selected));
      else p.delete(NODE_PARAM);
    });
  }, [selected]);

  // The found node glows once; the glow is dropped after it has played.
  useEffect(() => {
    if (!found) return;
    const t = window.setTimeout(() => setGlowing(false), GLOW_MS);
    return () => window.clearTimeout(t);
  }, [found]);
  const glowFound = useMemo<Glow[]>(
    () => (found && glowing ? [{ id: found.id, change: "found", step: found.key }] : []),
    [found, glowing],
  );

  // Open every branch, fetching the ones not loaded yet, up to EXPAND_ALL_LIMIT drawn nodes.
  /** Opens everything beneath `from`: the whole tree, or one node's branch. */
  const expandAll = useCallback(
    async (from: number = ROOT_ID) => {
      if (!server || expandingAll || tree.kind !== "ready") return;
      const gen = generation.current;
      setExpandingAll(true);
      setExpandNote(null);
      let work = slicesRef.current;
      try {
        let plan = fullExpansion(buildStore(work.map((s) => s.data)), EXPAND_ALL_LIMIT, from);
        while (plan.pending.length > 0) {
          const batch = plan.pending.slice(0, 8);
          const got = await pool(
            batch.map((id) => async () => {
              const q = { root: id, depth: EXPAND_ALL_DEPTH, show };
              const r = await fetchTree(server, q, null);
              return r.data ? { q, etag: r.etag, data: r.data } : null;
            }),
            4,
          );
          if (gen !== generation.current) return;
          const fetched = got.filter((s): s is Slice => s !== null);
          // A branch that returned nothing would be asked for again forever.
          if (fetched.length < batch.length) throw new Error("a branch did not load");
          work = [...work.filter((s) => !batch.includes(s.q.root)), ...fetched];
          plan = fullExpansion(buildStore(work.map((s) => s.data)), EXPAND_ALL_LIMIT, from);
        }
        setSlices(work);
        if (from === ROOT_ID) {
          setExpanded(plan.expanded);
          setFitKey((k) => k + 1);
        } else {
          // One branch: open the way to it and leave the rest and the view as they are.
          const path = ancestors(buildStore(work.map((s) => s.data)), from);
          setExpanded((ex) => new Set([...ex, ...path, ...plan.expanded]));
        }
        if (plan.limited)
          setExpandNote(
            `Large tree: opened the first ${String(EXPAND_ALL_LIMIT)} nodes. Open deeper branches one at a time.`,
          );
      } catch (e) {
        if (gen === generation.current)
          setRefreshError(`Could not expand everything: ${errorOf(e).message}`);
      } finally {
        setExpandingAll(false);
      }
    },
    [server, expandingAll, tree.kind, show],
  );

  const collapseAll = () => {
    // Back to the root and its direct children.
    setExpanded(new Set([ROOT_ID]));
    setExpandNote(null);
    setFitKey((k) => k + 1);
  };

  // Refresh every loaded slice with its tag: unchanged slices cost a 304.
  const refresh = useCallback(async () => {
    if (!server || refreshBusy.current || tree.kind === "loading") return;
    const current = slicesRef.current;
    if (current.length === 0) {
      void load(server, show, false);
      return;
    }
    refreshBusy.current = true;
    setRefreshing(true);
    const gen = generation.current;
    try {
      const results = await pool(
        current.map((s) => async () => {
          try {
            const r = await fetchTree(server, s.q, s.etag);
            return r.data ? { ...s, etag: r.etag, data: r.data } : s;
          } catch (e) {
            const err = errorOf(e);
            // A branch whose root was closed or moved away is dropped.
            if (err.code === "not_found" && s.q.root !== ROOT_ID) return null;
            throw err;
          }
        }),
        4,
      );
      if (gen !== generation.current) return;
      const changed = results.some((r, i) => r !== current[i]);
      if (changed) {
        setSlices(results.filter((r): r is Slice => r !== null));
        setChangedAt(new Date());
      }
      setCheckedAt(new Date());
      setRefreshError(null);
      const d = detailRef.current;
      if (d) void loadDetail(server, d.id, show, d.etag);
    } catch (e) {
      if (gen === generation.current) {
        setRefreshError(`Refresh failed: ${errorOf(e).message}`);
        setCheckedAt(new Date());
      }
    } finally {
      refreshBusy.current = false;
      setRefreshing(false);
    }
  }, [server, tree.kind, show, load, loadDetail]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible" && !replayRef.current) void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Escape closes the panel; with no panel open it leaves the isolated view (sheets, menus,
  // the search box and replay handle their own Escape first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailRef.current) {
        setSelected(null);
        setDetail(null);
      } else if (isolatedRef.current !== null && !replayRef.current && !e.defaultPrevented) {
        exitIsolate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitIsolate]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const menuNode = menu ? store.nodes.get(menu.id) : undefined;

  // The tree is laid out from the isolated node when it is known, else from the root.
  const isoNode = isolated !== null ? store.nodes.get(isolated) : undefined;
  const layoutFrom = isoNode ? isoNode.id : ROOT_ID;
  const layout = useMemo(
    () =>
      layoutRadial(
        layoutFrom,
        (id) => (expanded.has(id) ? knownChildren(store, id) : []),
        undefined,
      ),
    [store, expanded, layoutFrom],
  );

  // ---- replay ----
  const startReplay = useCallback(
    async (root: number) => {
      if (!server) return;
      const gen = generation.current;
      setReplay({ kind: "loading", root });
      setPlaying(false);
      try {
        const history = await fetchHistory(server, root);
        if (gen !== generation.current) return;
        const r = buildReplay(history);
        setReplay({ kind: "ready", root, replay: r });
        setStep(0);
        setFitKey((k) => k + 1);
        setPlaying(r.steps.length > 0);
      } catch (e) {
        if (gen !== generation.current) return;
        const err = errorOf(e);
        setReplay({
          kind: "error",
          root,
          message:
            err.code === "history_unsupported"
              ? "Replay needs Spokes 0.4.0 or later on this server."
              : err.code === "not_found"
                ? `SPOKE-${String(root)} is no longer in the tree.`
                : `Could not load the history: ${err.message}`,
        });
      }
    },
    [server],
  );

  const exitReplay = useCallback(() => {
    setReplay(null);
    setPlaying(false);
    setFitKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  const ready = replay?.kind === "ready" ? replay.replay : null;
  const total = ready?.steps.length ?? 0;

  // Playing: one step per tick, stopping at the end.
  useEffect(() => {
    if (!playing || !ready || step >= total) return;
    const t = window.setTimeout(() => {
      const next = Math.min(total, step + 1);
      setStep(next);
      if (next >= total) setPlaying(false);
    }, STEP_MS / speed);
    return () => window.clearTimeout(t);
  }, [playing, ready, step, total, speed]);

  const replayStore = useMemo(
    () => (ready ? storeAt(ready, step, show) : null),
    [ready, step, show],
  );
  const replayLayout = useMemo(
    () =>
      replayStore && ready
        ? layoutRadial(ready.history.root, (id) => knownChildren(replayStore, id), undefined)
        : null,
    [replayStore, ready],
  );
  const replayExpanded = useMemo(
    () => new Set(replayStore ? replayStore.complete : []),
    [replayStore],
  );
  // Glows for the steps recent enough to still be fading (more of them at higher speed).
  const highlight = useMemo(() => {
    if (!ready) return [];
    // At most 12 steps at once: at 16× more would only cost frames, not show more.
    const window = playing ? Math.min(12, Math.ceil(GLOW_MS / (STEP_MS / speed))) : 1;
    const out: Glow[] = [];
    for (let s = Math.max(1, step - window + 1); s <= step; s++)
      for (const c of changes(ready, s)) {
        // A change to a hidden node (done or dropped, with its toggle off) lights up the
        // nearest ancestor that is drawn, so the spot still shows.
        let id: number | null = c.id;
        const seen = new Set<number>();
        while (id !== null && !replayStore?.nodes.has(id) && !seen.has(id)) {
          seen.add(id);
          id = ready.byId.get(id)?.parent ?? null;
        }
        const shown = id;
        if (shown !== null && replayStore?.nodes.has(shown)) {
          // One glow per node per step (several hidden children can share an ancestor).
          if (!out.some((g) => g.step === s && g.id === shown))
            out.push({ ...c, id: shown, step: s });
        }
      }
    return out;
  }, [ready, replayStore, step, playing, speed]);

  const canReplay = (entry: ServerEntry | undefined) =>
    entry?.status === "ok" && versionAtLeast(entry.version, 0, 4);
  const canSearch = (entry: ServerEntry | undefined) =>
    entry?.status === "ok" && versionAtLeast(entry.version, 0, 5);

  const root = store.nodes.get(ROOT_ID);
  const current = servers?.find((s) => s.name === server);

  let body: ReactElement;
  if (serversError) {
    body = <Message title="Cannot load the server list">{serversError}</Message>;
  } else if (!servers) {
    body = <Message title="Loading…" />;
  } else if (servers.length === 0) {
    body = <Message title="No servers configured">Set SPOKES_VIEW_SERVERS.</Message>;
  } else if (tree.kind === "error") {
    body = (
      <TreeError
        error={tree.error}
        server={server ?? ""}
        onRetry={() => server && void load(server, show, false)}
      />
    );
  } else if (tree.kind === "loading" && slices.length === 0) {
    body = <Message title={`Loading ${server ?? ""}…`} />;
  } else if (root && root.child_count === 0) {
    body = (
      <Message title="This tree is empty">
        {root.closed_child_count > 0 && !(show.done && show.dropped)
          ? `There are ${root.closed_child_count} done or dropped items; turn on "Show done" or "Show dropped" to see them.`
          : "Nothing has been added to it yet."}
      </Message>
    );
  } else if (root && replay?.kind === "ready" && replayStore && replayLayout) {
    body =
      replayLayout.nodes.length > 0 ? (
        <Graph
          layout={replayLayout}
          store={replayStore}
          expanded={replayExpanded}
          loading={new Set()}
          selected={selected}
          fitKey={fitKey}
          onSelect={select}
          onToggle={() => undefined}
          onMenu={() => undefined}
          highlight={highlight}
          follow
          topInset={REPLAY_BAR_PX}
          softGlow={fullGlow || !playing || speed === 1}
        />
      ) : (
        <Message title="Nothing here yet">
          At this point in the history the subtree did not exist yet (or is closed).
        </Message>
      );
  } else if (root && isolated !== null && !isoNode) {
    body = <Message title={`Loading ${spokeId(isolated)}…`} />;
  } else if (root) {
    body = (
      <Graph
        layout={layout}
        store={store}
        expanded={expanded}
        loading={loading}
        selected={selected}
        fitKey={fitKey}
        onSelect={select}
        onToggle={(id) => void toggle(id)}
        focusOn={found}
        highlight={glowFound}
        onMenu={(id, x, y, via) => setMenu({ id, x, y, via })}
      />
    );
  } else {
    body = <Message title="Loading…" />;
  }

  return (
    <div className={`app ${detail ? "with-panel" : ""}`}>
      <AppBar
        server={server}
        tab="tree"
        nodeId={selected ?? ROOT_ID}
        crumb={isoNode && server ? `Isolated · ${server}` : (server ?? undefined)}
        title={
          selected !== null
            ? (store.nodes.get(selected)?.title ?? "To do")
            : (isoNode?.title ?? root?.title ?? "To do")
        }
        searching={searching}
        onSearch={() => setSearching((on) => !on)}
        extra={
          <div className={`appbar-search ${searching ? "open" : ""}`}>
            <Search
              // A new server starts with an empty box.
              key={server ?? ""}
              server={server}
              show={show}
              supported={canSearch(current)}
              disabled={tree.kind !== "ready" || !root || replay !== null}
              onPick={(hit) => {
                setSearching(false);
                void pickHit(hit);
              }}
            />
          </div>
        }
        status={
          changedAt
            ? `updated ${clock(changedAt)}${
                checkedAt && checkedAt.getTime() !== changedAt.getTime()
                  ? `, checked ${clock(checkedAt)}`
                  : ""
              }`
            : undefined
        }
        options={
          <>
            <OptGroup label="Server">
              <ServerPicker servers={servers} value={server} onChange={choose} />
            </OptGroup>
            <OptGroup label="Show" layout="list">
              <Toggle label="Done tasks" checked={show.done} onChange={() => toggleShown("done")} />
              <Toggle
                label="Dropped tasks"
                checked={show.dropped}
                onChange={() => toggleShown("dropped")}
              />
            </OptGroup>
            <OptGroup label="Branches" layout="grid2">
              <button
                type="button"
                className="btn"
                onClick={() => void expandAll()}
                disabled={expandingAll || tree.kind !== "ready" || !root || replay !== null}
              >
                {expandingAll ? "Expanding…" : "Expand all"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={collapseAll}
                disabled={
                  expandingAll || tree.kind !== "ready" || expanded.size <= 1 || replay !== null
                }
              >
                Collapse all
              </button>
            </OptGroup>
            <OptGroup layout="grid3">
              <button
                type="button"
                className="btn"
                onClick={() => void refresh()}
                disabled={refreshing || tree.kind === "loading" || replay !== null}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void startReplay(selected ?? ROOT_ID)}
                data-close-sheet
                disabled={tree.kind !== "ready" || !root || replay !== null || !canReplay(current)}
                title={
                  canReplay(current)
                    ? selected !== null
                      ? `Replay the history of ${scopeLabel(selected, store.nodes.get(selected)?.title, selected === ROOT_ID)}`
                      : "Replay the history of the whole tree (select a node to replay just its branch)"
                    : "Replay needs Spokes 0.4.0 or later"
                }
              >
                {replay?.kind === "loading" ? "Loading history…" : "Replay"}
              </button>
              <button
                type="button"
                className="btn opt-phone-only"
                data-close-sheet
                onClick={() => setLegendOpen((o) => !o)}
                disabled={tree.kind !== "ready" || !root}
              >
                Legend
              </button>
            </OptGroup>
          </>
        }
      />
      {(refreshError ?? expandNote ?? (store.truncated && tree.kind === "ready")) && (
        <div className={`notice ${refreshError ? "warn" : ""}`} role="status">
          {refreshError ??
            expandNote ??
            "Large tree: only the first levels are loaded. Branches load when you open them."}
        </div>
      )}
      <main className="main">
        {body}
        {isoNode && replay === null && (
          <>
            <div className="iso-frame" aria-hidden="true" />
            <div className="iso-bar">
              <div className="iso-pill">
                <span className="iso-label">Isolated</span>
                <span className="iso-title">{isoNode.title}</span>
                <button
                  type="button"
                  className="iso-exit"
                  aria-label="Exit isolated view"
                  onClick={exitIsolate}
                >
                  <Icon name="close" size="1rem" />
                </button>
              </div>
            </div>
          </>
        )}
        {ready && replay?.kind === "ready" && (
          <ReplayBar
            scope={scopeLabel(
              replay.root,
              ready.byId.get(replay.root)?.title,
              replay.root === ROOT_ID,
            )}
            step={step}
            total={total}
            playing={playing}
            speed={speed}
            at={ready.steps[step - 1]?.at ?? null}
            agent={ready.steps[step - 1]?.agent ?? null}
            caption={describeStep(ready, step)}
            firstAt={ready.steps[0]?.at ?? null}
            timeZone={ready.history.time_zone}
            truncated={ready.history.truncated}
            onStep={setStep}
            onPlay={setPlaying}
            onSpeed={setSpeed}
            fullGlow={fullGlow}
            onFullGlow={(on) => {
              setFullGlow(on);
              writeFlag(FULL_GLOW_KEY, on);
            }}
            onExit={exitReplay}
          />
        )}
        {replay?.kind === "error" && (
          <div className="notice warn floating replay-error" role="alert">
            {replay.message}{" "}
            <button type="button" className="btn" onClick={() => setReplay(null)}>
              OK
            </button>
          </div>
        )}
        {tree.kind === "ready" && root && <Legend open={legendOpen} onToggle={setLegendOpen} />}
        {current && current.status !== "ok" && tree.kind !== "error" && (
          <div className="notice warn floating">{current.message}</div>
        )}
      </main>
      {detail && server && (
        <DetailPanel
          detail={detail}
          fromTree={store.nodes.get(detail.id)}
          timeZone={store.meta?.time_zone ?? "UTC"}
          today={store.meta?.today ?? ""}
          expanded={expanded.has(detail.id)}
          onClose={() => {
            setSelected(null);
            setDetail(null);
          }}
          onSelect={select}
          onToggle={(id) => void toggle(id)}
          server={server}
          onActions={(n, x, y) => setMenu({ id: n.id, x, y, via: "pointer" })}
        />
      )}
      {menu && menuNode && server && (
        <NodeActions
          via={menu.via}
          x={menu.x}
          y={menu.y}
          id={menuNode.id}
          title={menuNode.title}
          onClose={closeMenu}
          items={[
            { label: "Show details", icon: "details" as const, onPick: () => select(menuNode.id) },
            ...(menuNode.child_count > 0
              ? [
                  {
                    label:
                      expanded.has(menuNode.id) && knownChildren(store, menuNode.id).length > 0
                        ? "Collapse branch"
                        : "Expand branch",
                    icon: "expand" as const,
                    onPick: () => void toggle(menuNode.id),
                  },
                  {
                    label: "Expand all below",
                    hint: "Open every level under it",
                    icon: "expand" as const,
                    onPick: () => void expandAll(menuNode.id),
                  },
                ]
              : []),
            ...(menuNode.id !== ROOT_ID && menuNode.child_count > 0
              ? [
                  {
                    label: "Isolate",
                    hint: "Only this branch, with a way back",
                    icon: "focus" as const,
                    onPick: () => isolate(menuNode.id),
                  },
                ]
              : []),
            ...(menuNode.id !== ROOT_ID
              ? [
                  {
                    label: "Close others",
                    hint: "Collapse every other branch",
                    icon: "collapse" as const,
                    onPick: () => {
                      setExpanded(closeOthers(store, expanded, menuNode.id));
                      setExpandNote(null);
                      setFitKey((k) => k + 1);
                    },
                  },
                ]
              : []),
            ...linkActions(server, menuNode, { tree: false, isolate: false }),
          ]}
        />
      )}
    </div>
  );
}

function Message({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  return (
    <div className="message" role="status">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function TreeError({
  error,
  server,
  onRetry,
}: {
  error: ApiError;
  server: string;
  onRetry: () => void;
}): ReactElement {
  const title =
    error.code === "too_old"
      ? `${server} is too old`
      : error.code === "unreachable"
        ? `${server} is unreachable`
        : error.code === "network"
          ? "spokes-view is unreachable"
          : `Cannot show ${server}`;
  const hint =
    error.code === "too_old"
      ? "Upgrade that Spokes server to 0.2.0 or later to view it here."
      : error.code === "unreachable"
        ? "Check that the server is running and reachable from the spokes-view host."
        : null;
  return (
    <div className="message error" role="alert">
      <h2>{title}</h2>
      <p>{error.message}</p>
      {hint && <p className="muted">{hint}</p>}
      <button type="button" className="btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
