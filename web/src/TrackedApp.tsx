import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ApiError, fetchTracked } from "./api";
import { AppBar } from "./AppBar";
import { clock, spokeId } from "./format";
import type { MenuVia } from "./Graph";
import { Icon } from "./Icon";
import { kanbanUrl } from "./kanban";
import { linkActions, NodeActions, useNodeMenu } from "./NodeActions";
import { TypeIcon } from "./TypeIcon";
import type { TrackedEntry, TrackedResponse } from "./types";
import { percentDone } from "./tracked";
import { OptGroup } from "./ViewOptions";

const REFRESH_MS = 30_000;

/**
 * The nodes the user follows (marked tracked through MCP, e.g. "track SPOKE-1017"), each
 * with its progress. A tap opens its board; a long-press or right-click shows the rest.
 */
export function TrackedApp({ server }: { server: string | null }): ReactElement {
  const [data, setData] = useState<TrackedResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number; via: MenuVia } | null>(null);
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!server) return;
    setRefreshing(true);
    try {
      const r = await fetchTracked(server, etag.current);
      if (r.data) setData(r.data);
      etag.current = r.etag;
      setError(null);
      setCheckedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("network", 0, String(e)));
    } finally {
      setRefreshing(false);
    }
  }, [server]);

  useEffect(() => {
    document.title = "Tracked · Spokes view";
    // First load on the next tick (not inside the effect itself), then every 30 s.
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [load]);

  const menuEntry = menu ? data?.nodes.find((e) => e.node.id === menu.id) : undefined;

  let body: ReactElement;
  if (!server) {
    body = <p className="tracked-note">Open this page from the tree.</p>;
  } else if (error) {
    body = (
      <p className="tracked-note warn" role="alert">
        {error.code === "tracked_unsupported"
          ? "This Spokes server is older than 0.15.0, so it can't keep a tracked list yet."
          : error.message}
      </p>
    );
  } else if (!data) {
    body = <p className="tracked-note">Loading…</p>;
  } else if (data.nodes.length === 0) {
    body = (
      <div className="tracked-empty">
        <Icon name="tracked" size="2rem" />
        <strong>Nothing tracked yet</strong>
        <p>
          To follow an epic or task here, ask an agent: <code>track SPOKE-1017</code>. Spokes View
          only reads, so tracking is set through MCP.
        </p>
      </div>
    );
  } else {
    body = (
      <ol className="tracked-list">
        {data.nodes.map((e) => (
          <li key={e.node.id}>
            <TrackedCard
              entry={e}
              server={server}
              onMenu={(x, y, via) => setMenu({ id: e.node.id, x, y, via })}
            />
          </li>
        ))}
        <li className="tracked-hint">
          To track more, ask an agent: <code>track SPOKE-n</code>. Spokes View only reads.
        </li>
      </ol>
    );
  }

  return (
    <div className="app kanban-app tracked-app">
      <AppBar
        server={server}
        tab="tracked"
        nodeId={1}
        crumb={server ? `${server} · tracked through MCP` : undefined}
        title="Tracked"
        status={checkedAt ? `checked ${clock(checkedAt)}` : undefined}
        options={
          <OptGroup>
            <button
              type="button"
              className="btn"
              onClick={() => void load()}
              disabled={refreshing || !server}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </OptGroup>
        }
      />
      <main className="main tracked-main">{body}</main>
      {menu && menuEntry && server && (
        <NodeActions
          via={menu.via}
          x={menu.x}
          y={menu.y}
          id={menuEntry.node.id}
          title={menuEntry.node.title}
          onClose={() => setMenu(null)}
          items={linkActions(server, menuEntry.node)}
        />
      )}
    </div>
  );
}

function TrackedCard({
  entry,
  server,
  onMenu,
}: {
  entry: TrackedEntry;
  server: string;
  onMenu: (x: number, y: number, via: MenuVia) => void;
}): ReactElement {
  const { node, path, progress } = entry;
  const menu = useNodeMenu(onMenu);
  const pct = percentDone(progress);
  const open = Math.max(0, progress.total - progress.done - progress.in_progress);
  const share = (n: number) => (progress.total === 0 ? 0 : (n / progress.total) * 100);
  const complete = progress.total > 0 && progress.done === progress.total;
  return (
    <a className="tracked-card" href={kanbanUrl(server, node.id)} data-node-id={node.id} {...menu}>
      <span className="tracked-top">
        <span className={`tracked-icon ${node.type ? `t-${node.type}` : ""}`} aria-hidden="true">
          {node.type ? <TypeIcon type={node.type} /> : <Icon name="tracked" />}
        </span>
        <span className="tracked-head">
          <small>
            {path
              .slice(-2)
              .map((c) => c.title)
              .join(" › ")}
            {path.length > 0 ? " · " : ""}
            <span className="mono">{spokeId(node.id)}</span>
          </small>
          <strong>{node.title}</strong>
        </span>
        <span className="tracked-go" aria-hidden="true">
          ›
        </span>
      </span>
      <span
        className="tracked-bar"
        role="img"
        aria-label={`${String(progress.done)} of ${String(progress.total)} done`}
      >
        <span className="bar-done" style={{ width: `${String(share(progress.done))}%` }} />
        <span className="bar-prog" style={{ width: `${String(share(progress.in_progress))}%` }} />
      </span>
      <span className="tracked-stats">
        <strong className={complete ? "all-done" : ""}>
          {progress.total === 0 ? "No tasks yet" : complete ? "All done" : `${String(pct)}%`}
        </strong>
        <span>
          <i className="dot s-done" /> {progress.done} done
        </span>
        <span>
          <i className="dot s-in_progress" /> {progress.in_progress} in progress
        </span>
        <span>
          <i className="dot s-open" /> {open} open
        </span>
      </span>
    </a>
  );
}
