import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { clock, markers, spokeId, isEpic } from "./format";
import {
  buildBoard,
  CARD_PAGE,
  collapsedFrom,
  COLUMN_PARAM,
  GROUP_PARAM,
  groupingFrom,
  initialColumn,
  treeUrl,
  withCollapsed,
  type Card,
  type Grouping,
} from "./kanban";
import { usePhone } from "./usePhone";
import { replaceQuery } from "./urlState";
import { AppBar } from "./AppBar";
import { Search } from "./Search";
import { Icon } from "./Icon";
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
    // New columns: a phone starts again from the default column.
    url.searchParams.delete(COLUMN_PARAM);
    window.history.replaceState(window.history.state, "", url);
    setRequested(null);
  };

  const [menu, setMenu] = useState<{ id: number; x: number; y: number; via: MenuVia } | null>(null);
  const board = useMemo(() => (data ? buildBoard(data, show, group) : []), [data, show, group]);
  const rootNode = data?.nodes.find((n) => n.id === rootId);
  const nodesById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n])), [data]);
  const menuNode = menu ? nodesById.get(menu.id) : undefined;
  const total = board.reduce((sum, c) => sum + c.cards.length, 0);

  // Phones show one column at a time (tabs above, swipe between); wide screens show them
  // all, and any can fold to a rail. Big columns show CARD_PAGE cards at a time.
  const phone = usePhone();
  const boardRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get(COLUMN_PARAM),
  );
  const activeKey = initialColumn(board, requested);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    collapsedFrom(window.location.search),
  );
  const [limits, setLimits] = useState<Record<string, number>>({});
  const toggleCollapsed = (key: string): void => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
    replaceQuery((p) => withCollapsed(p, next));
  };
  const showColumn = (i: number, smooth: boolean): void => {
    const el = boardRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };
  const onBoardScroll = (): void => {
    const el = boardRef.current;
    if (!el || el.clientWidth === 0) return;
    const key = board[Math.round(el.scrollLeft / el.clientWidth)]?.key;
    if (key && key !== activeKey) {
      setRequested(key);
      replaceQuery((p) => p.set(COLUMN_PARAM, key));
    }
  };
  // Land on the active column without animating when the board (re)appears on a phone.
  const landed = useRef<Grouping | null>(null);
  useLayoutEffect(() => {
    if (!phone) {
      landed.current = null;
      return;
    }
    if (landed.current === group || board.length === 0) return;
    const i = board.findIndex((c) => c.key === activeKey);
    if (i >= 0) showColumn(i, false);
    landed.current = group;
  });
  // Keep the active tab in view as you swipe.
  useEffect(() => {
    document.querySelector(".col-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);
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
    const label = (col: (typeof board)[number]) => (
      <>
        {group === "status" && <span className={`status-dot s-${col.key}`} aria-hidden="true" />}
        {group === "refinement" && col.key !== "none" && (
          <span className={`refinement-dot st-${col.key}`} aria-hidden="true" />
        )}
        <span className="column-name">{col.label}</span>
        <span className="count">{col.cards.length}</span>
      </>
    );
    body = (
      <>
        {phone && (
          <div className="col-tabs" role="tablist" aria-label="Columns">
            {board.map((col, i) => (
              <button
                key={col.key}
                type="button"
                role="tab"
                aria-selected={col.key === activeKey}
                className={`col-tab ${col.key === activeKey ? "on" : ""}`}
                onClick={() => showColumn(i, true)}
              >
                {label(col)}
              </button>
            ))}
          </div>
        )}
        <div
          ref={boardRef}
          className="board"
          onScroll={phone ? onBoardScroll : undefined}
          style={
            phone
              ? undefined
              : {
                  gridTemplateColumns: board
                    .map((c) => (collapsed.has(c.key) ? "3.25rem" : "minmax(16rem, 1fr)"))
                    .join(" "),
                }
          }
        >
          {board.map((col) => {
            const folded = !phone && collapsed.has(col.key);
            const shown = limits[col.key] ?? CARD_PAGE;
            return (
              <section
                key={col.key}
                className={`column ${folded ? "collapsed" : ""}`}
                aria-label={col.label}
                role={phone ? "tabpanel" : undefined}
              >
                {folded ? (
                  <button
                    type="button"
                    className="column-rail"
                    onClick={() => toggleCollapsed(col.key)}
                    title={`Expand the ${col.label} column`}
                    aria-label={`Expand the ${col.label} column`}
                  >
                    <Icon name="unfold" size="1.1rem" />
                    {label(col)}
                  </button>
                ) : (
                  <>
                    {!phone && (
                      <h2>
                        {label(col)}
                        <button
                          type="button"
                          className="column-fold"
                          onClick={() => toggleCollapsed(col.key)}
                          aria-label={`Collapse the ${col.label} column`}
                          title="Collapse column (shrink it to a thin strip)"
                        >
                          <Icon name="fold" size="1.1rem" />
                        </button>
                      </h2>
                    )}
                    <ol className="cards">
                      {col.cards.slice(0, shown).map((c) => (
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
                    {col.cards.length > shown && (
                      <button
                        type="button"
                        className="show-more"
                        onClick={() => setLimits((l) => ({ ...l, [col.key]: shown + CARD_PAGE }))}
                      >
                        Show {Math.min(CARD_PAGE, col.cards.length - shown)} more ·{" "}
                        {col.cards.length - shown} left
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      </>
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
        extra={
          // Desktop: the same search box as the tree; a pick opens the tree on that node.
          // Phones use the Search tab instead.
          server ? (
            <div className="appbar-search">
              <Search
                server={server}
                show={show}
                supported
                disabled={false}
                onPick={(hit) => {
                  window.location.href = treeUrl(server, hit.id);
                }}
              />
            </div>
          ) : undefined
        }
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
