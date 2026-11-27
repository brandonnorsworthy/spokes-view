import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { clock, markers, spokeId, isEpic } from "./format";
import { buildBoard, GROUP_PARAM, groupingFrom, type Card, type Grouping } from "./kanban";
import { AppBar } from "./AppBar";
import { OptGroup, Segmented, Toggle } from "./ViewOptions";
import type { MenuVia } from "./Graph";
import { linkActions, NodeActions, useNodeMenu } from "./NodeActions";
import { NodeModal } from "./NodeModal";
import { TypeRefinementChips } from "./TypeRefinementChips";
import { useSubtree } from "./useSubtree";
import { ViewLinks } from "./ViewLinks";

interface Props {
  server: string | null;
  rootId: number;
}

/** A kanban board of every task beneath `rootId`, one column per status or refinement. */
export function KanbanApp({ server, rootId }: Props): ReactElement {
  const {
    show,
    toggleShown,
    data,
    error,
    refreshError,
    refreshing,
    checkedAt,
    refresh,
    detail,
    openDetail: open,
    closeDetail,
  } = useSubtree(server, rootId);

  const [group, setGroup] = useState<Grouping>(() => groupingFrom(window.location.search));
  const changeGroup = (next: Grouping): void => {
    setGroup(next);
    const url = new URL(window.location.href);
    if (next === "refinement") url.searchParams.set(GROUP_PARAM, "refinement");
    else url.searchParams.delete(GROUP_PARAM);
    window.history.replaceState(window.history.state, "", url);
  };

  const [menu, setMenu] = useState<{ id: number; x: number; y: number; via: MenuVia } | null>(null);
  const board = useMemo(() => (data ? buildBoard(data, show, group) : []), [data, show, group]);
  const rootNode = data?.nodes.find((n) => n.id === rootId);
  const nodesById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n])), [data]);
  const menuNode = menu ? nodesById.get(menu.id) : undefined;
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
      <Message title="No tasks beneath this node">
        {!show.done && !show.dropped && rootNode && rootNode.closed_child_count > 0
          ? 'Its closed children are hidden; turn on "Show done" or "Show dropped" to see them.'
          : "There is nothing to put on the board yet."}
      </Message>
    );
  } else {
    body = (
      <div className="board">
        {board.map((col) => (
          <section key={col.key} className="column" aria-label={col.label}>
            <h2>
              {group === "status" && (
                <span className={`status-dot s-${col.key}`} aria-hidden="true" />
              )}
              {group === "refinement" && col.key !== "none" && (
                <span className={`refinement-dot st-${col.key}`} aria-hidden="true" />
              )}
              {col.label}
              <span className="count">{col.cards.length}</span>
            </h2>
            <ol className="cards">
              {col.cards.map((c) => (
                <li key={c.node.id}>
                  <KanbanCard
                    card={c}
                    today={today}
                    onOpen={open}
                    onMenu={(x, y, via) => setMenu({ id: c.node.id, x, y, via })}
                  />
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
      <AppBar
        server={server}
        tab="board"
        nodeId={rootId}
        crumb={
          data && data.path.length > 0
            ? data.path
                .slice(-2)
                .map((c) => c.title)
                .join(" › ")
            : undefined
        }
        title={rootNode?.title ?? spokeId(rootId)}
        status={
          data ? `${total} items${checkedAt ? `, checked ${clock(checkedAt)}` : ""}` : undefined
        }
        options={
          <>
            <OptGroup label="Group columns by">
              <Segmented
                label="Group columns by"
                value={group}
                options={[
                  ["status", "Status"],
                  ["refinement", "Refinement"],
                ]}
                onChange={changeGroup}
              />
            </OptGroup>
            <OptGroup label="Show" layout="list">
              <Toggle label="Done tasks" checked={show.done} onChange={() => toggleShown("done")} />
              <Toggle
                label="Dropped tasks"
                checked={show.dropped}
                onChange={() => toggleShown("dropped")}
              />
            </OptGroup>
            <OptGroup>
              <button
                type="button"
                className="btn"
                onClick={() => void refresh()}
                disabled={refreshing || !data}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </OptGroup>
          </>
        }
      />
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
          onClose={closeDetail}
          onSelect={open}
          actions={(n) => <ViewLinks server={server} node={n} />}
        />
      )}
      {menu && menuNode && server && (
        <NodeActions
          via={menu.via}
          x={menu.x}
          y={menu.y}
          id={menuNode.id}
          title={menuNode.title}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Show details",
              icon: "details",
              onPick: () => open(menuNode.id),
            },
            ...linkActions(server, menuNode),
          ]}
        />
      )}
    </div>
  );
}

function KanbanCard({
  card,
  today,
  onOpen,
  onMenu,
}: {
  card: Card;
  today: string;
  onOpen: (id: number) => void;
  onMenu: (x: number, y: number, via: MenuVia) => void;
}): ReactElement {
  const n = card.node;
  const menu = useNodeMenu(onMenu);
  const ms = markers(n, today);
  const prio = n.effective_priority;
  return (
    <button
      type="button"
      className={`card ${n.deferred ? "deferred" : ""} ${isEpic(n) ? "epic" : ""}`}
      data-status={n.status}
      onClick={() => onOpen(n.id)}
      {...menu}
    >
      {card.path.length > 0 && (
        <span className="card-path">{card.path.map((p) => p.title).join(" / ")}</span>
      )}
      <span className="card-title">{n.title}</span>
      <span className="card-meta">
        <span className="mono">{spokeId(n.id)}</span>
        <TypeRefinementChips node={n} />
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
