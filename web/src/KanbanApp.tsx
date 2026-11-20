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
import { ApiError, fetchNode, fetchTree, type TreeQuery } from "./api";
import type { DetailState } from "./DetailPanel";
import { clock, markers, spokeId, STATUS_LABEL } from "./format";
import { buildBoard, kanbanUrl, type Card } from "./kanban";
import { NodeModal } from "./NodeModal";
import type { TreeResponse } from "./types";

/** The API's deepest slice: the board shows this many levels beneath its root. */
const BOARD_DEPTH = 10;
const REFRESH_MS = 30_000;

function errorOf(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError("upstream_error", 0, String(e));
}

interface Props {
  server: string | null;
  rootId: number;
}

/** A kanban board of every node beneath `rootId`, one column per status. */
export function KanbanApp({ server, rootId }: Props): ReactElement {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [slice, setSlice] = useState<{ etag: string | null; data: TreeResponse } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const sliceRef = useRef(slice);
  const detailRef = useRef(detail);
  useLayoutEffect(() => {
    sliceRef.current = slice;
    detailRef.current = detail;
  }, [slice, detail]);
  /** Bumped when the closed toggle changes; stale responses are dropped. */
  const generation = useRef(0);

  const query = useCallback(
    (closed: boolean): TreeQuery => ({ root: rootId, depth: BOARD_DEPTH, includeClosed: closed }),
    [rootId],
  );

  // First load, and again when the closed toggle changes.
  useEffect(() => {
    if (!server) return;
    const gen = ++generation.current;
    const ctl = new AbortController();
    fetchTree(server, query(includeClosed), null, ctl.signal)
      .then((r) => {
        if (gen !== generation.current || !r.data) return;
        setError(null);
        setSlice({ etag: r.etag, data: r.data });
        setCheckedAt(new Date());
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen === generation.current) setError(errorOf(e));
      });
    return () => ctl.abort();
  }, [server, includeClosed, query]);

  const loadDetail = useCallback(
    async (id: number, etag: string | null) => {
      if (!server) return;
      try {
        const r = await fetchNode(server, id, includeClosed, etag);
        if (detailRef.current?.id !== id) return;
        if (r.data) setDetail({ id, data: r.data, etag: r.etag, error: null, loading: false });
      } catch (e) {
        if (detailRef.current?.id !== id) return;
        const err = errorOf(e);
        setDetail((d) =>
          d && d.id === id
            ? {
                ...d,
                loading: false,
                error:
                  err.code === "not_found" ? "This node is no longer in the tree." : err.message,
              }
            : d,
        );
      }
    },
    [server, includeClosed],
  );

  const open = useCallback(
    (id: number) => {
      setDetail({ id, data: null, etag: null, error: null, loading: true });
      void loadDetail(id, null);
    },
    [loadDetail],
  );

  // Refresh with the slice's tag: an unchanged board costs a 304.
  const refresh = useCallback(async () => {
    const cur = sliceRef.current;
    if (!server || !cur || refreshing) return;
    const gen = generation.current;
    setRefreshing(true);
    try {
      const r = await fetchTree(server, query(includeClosed), cur.etag);
      if (gen !== generation.current) return;
      if (r.data) setSlice({ etag: r.etag, data: r.data });
      setRefreshError(null);
      const d = detailRef.current;
      if (d) void loadDetail(d.id, d.etag);
    } catch (e) {
      if (gen === generation.current) setRefreshError(`Refresh failed: ${errorOf(e).message}`);
    } finally {
      setCheckedAt(new Date());
      setRefreshing(false);
    }
  }, [server, refreshing, query, includeClosed, loadDetail]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  const board = useMemo(
    () => (slice ? buildBoard(slice.data, includeClosed) : []),
    [slice, includeClosed],
  );
  const data = slice?.data;
  const rootNode = data?.nodes.find((n) => n.id === rootId);
  const nodesById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n])), [data]);
  const total = board.reduce((sum, c) => sum + c.cards.length, 0);
  const today = data?.today ?? "";

  useEffect(() => {
    const title = rootNode ? `${rootNode.title} · Kanban` : "Kanban";
    document.title = `${title} · Spokes view`;
  }, [rootNode]);

  let body: ReactElement;
  if (!server) {
    body = <Message title="No server named">Open this board from the graph view.</Message>;
  } else if (error) {
    body = (
      <Message title={`Cannot show ${spokeId(rootId)} on ${server}`} error>
        {error.message}
      </Message>
    );
  } else if (!data) {
    body = <Message title="Loading…" />;
  } else if (total === 0) {
    body = (
      <Message title="Nothing beneath this node">
        {!includeClosed && rootNode && rootNode.closed_child_count > 0
          ? 'Its children are all closed; turn on "Show closed" to see them.'
          : "It has no children yet."}
      </Message>
    );
  } else {
    body = (
      <div className="board">
        {board.map((col) => (
          <section key={col.status} className="column" aria-label={STATUS_LABEL[col.status]}>
            <h2>
              <span className={`status-dot s-${col.status}`} aria-hidden="true" />
              {STATUS_LABEL[col.status]}
              <span className="count">{col.cards.length}</span>
            </h2>
            <ol className="cards">
              {col.cards.map((c) => (
                <li key={c.node.id}>
                  <KanbanCard card={c} today={today} onOpen={open} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="app kanban-app">
      <header className="bar">
        <h1>
          <span className="logo" aria-hidden="true" />
          <a className="home" href={server ? `/?server=${encodeURIComponent(server)}` : "/"}>
            Spokes view
          </a>
          <span className="muted">/</span>
          <span className="board-title">
            {data?.path.map((c) => c.title).join(" / ")}
            {data && data.path.length > 0 ? " / " : ""}
            <strong>{rootNode?.title ?? spokeId(rootId)}</strong>
          </span>
        </h1>
        {server && <span className="chip">{server}</span>}
        <label className="check">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={() => setIncludeClosed((c) => !c)}
          />
          Show closed
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={refreshing || !data}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <span className="updated" aria-live="polite">
          {data && `${total} items`}
          {checkedAt && ` · checked ${clock(checkedAt)}`}
        </span>
      </header>
      {(refreshError ?? data?.truncated) && (
        <div className={`notice ${refreshError ? "warn" : ""}`} role="status">
          {refreshError ??
            "Large branch: the board shows only the nodes Spokes would return in one slice."}
        </div>
      )}
      <main className="main kanban-main">{body}</main>
      {detail && server && (
        <NodeModal
          detail={detail}
          fromTree={nodesById.get(detail.id)}
          timeZone={data?.time_zone ?? "UTC"}
          today={today}
          onClose={() => setDetail(null)}
          onSelect={open}
          actions={(n) =>
            n.child_count > 0 && (
              <p className="actions">
                <a
                  className="btn"
                  href={kanbanUrl(server, n.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Kanban ↗
                </a>
              </p>
            )
          }
        />
      )}
    </div>
  );
}

function KanbanCard({
  card,
  today,
  onOpen,
}: {
  card: Card;
  today: string;
  onOpen: (id: number) => void;
}): ReactElement {
  const n = card.node;
  const ms = markers(n, today);
  const prio = n.effective_priority;
  return (
    <button
      type="button"
      className={`card ${n.deferred ? "deferred" : ""}`}
      data-status={n.status}
      onClick={() => onOpen(n.id)}
    >
      {card.path.length > 0 && (
        <span className="card-path">{card.path.map((p) => p.title).join(" / ")}</span>
      )}
      <span className="card-title">{n.title}</span>
      <span className="card-meta">
        <span className="mono">{spokeId(n.id)}</span>
        {n.kind === "area" && <span className="chip">area</span>}
        {prio !== null && (
          <span className={`chip prio-chip p${prio}`} title={`Priority ${prio}`}>
            P{prio}
          </span>
        )}
        {n.progress && (
          <span className="muted" title="Steps done">
            {n.progress.done}/{n.progress.total}
          </span>
        )}
        {n.child_count > 0 && !n.progress && (
          <span className="muted" title="Children">
            {n.child_count} beneath
          </span>
        )}
        {ms.map((m) => (
          <span key={m.key} className={`marker ${m.cls}`} title={m.title}>
            {m.glyph}
          </span>
        ))}
      </span>
    </button>
  );
}

function Message({
  title,
  children,
  error,
}: {
  title: string;
  children?: ReactNode;
  error?: boolean;
}): ReactElement {
  return (
    <div className={`message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
