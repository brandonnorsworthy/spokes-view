import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  buildOutline,
  isFiltering,
  NO_FILTER,
  visibleRows,
  type Row,
  type RowFilter,
} from "./backlog";
import {
  clock,
  dueText,
  markers,
  NODE_TYPES,
  spokeId,
  REFINEMENT_LABEL,
  REFINEMENTS,
  STATUS_LABEL,
  TYPE_LABEL,
  isEpic,
} from "./format";
import { AppBar } from "./AppBar";
import { revealNode } from "./reveal";
import { Search } from "./Search";
import { OptGroup, Toggle } from "./ViewOptions";
import type { MenuVia } from "./Graph";
import { linkActions, NodeActions, useNodeMenu } from "./NodeActions";
import { NodeModal } from "./NodeModal";
import { TypeRefinementChips } from "./TypeRefinementChips";
import { filterFrom, replaceQuery, withFilter } from "./urlState";
import { useSubtree } from "./useSubtree";
import { ViewLinks } from "./ViewLinks";

interface Props {
  server: string | null;
  rootId: number;
}

/** Every node beneath `rootId` as an indented list, with collapsible branches and a filter. */
export function BacklogApp({ server, rootId }: Props): ReactElement {
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
    openDetail,
    closeDetail,
  } = useSubtree(server, rootId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [filter, setFilter] = useState<RowFilter>(() => ({
    ...NO_FILTER,
    ...filterFrom(window.location.search),
  }));
  const changeFilter = (patch: Partial<RowFilter>): void => {
    const next = { ...filter, ...patch };
    setFilter(next);
    replaceQuery((p) => withFilter(p, next));
  };

  const outline = useMemo(() => (data ? buildOutline(data) : []), [data]);
  const rows = useMemo(() => visibleRows(outline, collapsed, filter), [outline, collapsed, filter]);
  const nodesById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n])), [data]);
  const rootNode = nodesById.get(rootId);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<{
    id: number;
    x: number;
    y: number;
    via: MenuVia;
    fromDetails?: boolean;
  } | null>(null);
  const menuNode = menu ? nodesById.get(menu.id) : undefined;
  const today = data?.today ?? "";
  const filtering = isFiltering(filter);

  const toggle = useCallback((id: number) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const collapseAll = useCallback(
    () => setCollapsed(new Set(outline.filter((r) => r.hasRows).map((r) => r.node.id))),
    [outline],
  );

  useEffect(() => {
    const title = rootNode ? `${rootNode.title} · Backlog` : "Backlog";
    document.title = `${title} · Spokes view`;
  }, [rootNode]);

  let body: ReactElement;
  if (!server) {
    body = <Message title="No server named">Open the backlog from the graph view.</Message>;
  } else if (error) {
    body = (
      <Message title={`Cannot show ${spokeId(rootId)} on ${server}`} error>
        {error.message}
      </Message>
    );
  } else if (!data) {
    body = <Message title="Loading…" />;
  } else if (outline.length === 0) {
    body = (
      <Message title="Nothing beneath this node">
        {!show.done && !show.dropped && rootNode && rootNode.closed_child_count > 0
          ? 'Its children are all closed; turn on "Show done" or "Show dropped" to see them.'
          : "It has no children yet."}
      </Message>
    );
  } else if (rows.length === 0) {
    body = <Message title="No matches">Nothing here matches the current filters.</Message>;
  } else {
    body = (
      <ol className="backlog" aria-label="Backlog">
        {rows.map((r) => (
          <li key={r.node.id}>
            <BacklogRow
              row={r}
              today={today}
              open={filtering || !collapsed.has(r.node.id)}
              canToggle={r.hasRows && !filtering}
              onToggle={toggle}
              onOpen={openDetail}
              onMenu={(x, y, via) => setMenu({ id: r.node.id, x, y, via })}
            />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="app kanban-app backlog-app">
      <AppBar
        server={server}
        tab="backlog"
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
        searching={searching}
        onSearch={() => setSearching((on) => !on)}
        extra={
          // The same search box as the tree (on a phone, behind the Search tab). A pick
          // stays on this page.
          server ? (
            <div className={`appbar-search ${searching ? "open" : ""}`}>
              <Search
                server={server}
                show={show}
                supported
                disabled={false}
                onPick={(hit) => {
                  setSearching(false);
                  // Stay on the backlog: open the branches down to the row, show it, open
                  // its details. A node outside this backlog still opens its details here.
                  if (outline.some((r) => r.node.id === hit.id)) {
                    const up = new Set(hit.path.map((c) => c.id));
                    setCollapsed((c) => new Set([...c].filter((x) => !up.has(x))));
                    revealNode(hit.id);
                  }
                  openDetail(hit.id);
                }}
              />
            </div>
          ) : undefined
        }
        status={
          data
            ? `${filtering ? `${rows.length} of ${outline.length}` : `${outline.length} items`}${
                checkedAt ? `, checked ${clock(checkedAt)}` : ""
              }`
            : undefined
        }
        options={
          <>
            <OptGroup label="Filter">
              <label className="filter">
                <span className="sr-only">Filter</span>
                <input
                  type="search"
                  placeholder="Filter by title or SPOKE-N"
                  value={filter.text}
                  onChange={(e) => changeFilter({ text: e.target.value })}
                />
              </label>
            </OptGroup>
            <OptGroup layout="grid2">
              <label className="filter">
                <span className="sr-only">Type</span>
                <select
                  value={filter.type}
                  onChange={(e) => changeFilter({ type: e.target.value as RowFilter["type"] })}
                >
                  <option value="any">Any type</option>
                  {NODE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                  <option value="none">No type</option>
                </select>
              </label>
              <label className="filter">
                <span className="sr-only">Refinement</span>
                <select
                  value={filter.refinement}
                  onChange={(e) =>
                    changeFilter({ refinement: e.target.value as RowFilter["refinement"] })
                  }
                >
                  <option value="any">Any refinement</option>
                  {REFINEMENTS.map((st) => (
                    <option key={st} value={st}>
                      {REFINEMENT_LABEL[st]}
                    </option>
                  ))}
                  <option value="none">No refinement</option>
                </select>
              </label>
            </OptGroup>
            <OptGroup label="Show" layout="list">
              <Toggle label="Done tasks" checked={show.done} onChange={() => toggleShown("done")} />
              <Toggle
                label="Dropped tasks"
                checked={show.dropped}
                onChange={() => toggleShown("dropped")}
              />
            </OptGroup>
            <OptGroup layout="grid3">
              <button
                type="button"
                className="btn"
                onClick={() => setCollapsed(new Set())}
                disabled={collapsed.size === 0 || filtering}
              >
                Expand all
              </button>
              <button
                type="button"
                className="btn"
                onClick={collapseAll}
                disabled={filtering || !data}
              >
                Collapse all
              </button>
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
            "Large branch: the list shows only the nodes Spokes would return in one slice."}
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
          onSelect={openDetail}
          actions={(n) => <ViewLinks server={server} node={n} />}
          onActions={(n, x, y) => setMenu({ id: n.id, x, y, via: "pointer", fromDetails: true })}
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
            // The details' own ⋯ button: they are already open.
            ...(menu.fromDetails
              ? []
              : [
                  {
                    label: "Show details",
                    icon: "details" as const,
                    onPick: () => openDetail(menuNode.id),
                  },
                ]),
            ...linkActions(server, menuNode),
          ]}
        />
      )}
    </div>
  );
}

function BacklogRow({
  row,
  today,
  open,
  canToggle,
  onToggle,
  onOpen,
  onMenu,
}: {
  row: Row;
  today: string;
  open: boolean;
  canToggle: boolean;
  onToggle: (id: number) => void;
  onOpen: (id: number) => void;
  onMenu: (x: number, y: number, via: MenuVia) => void;
}): ReactElement {
  const n = row.node;
  const menu = useNodeMenu(onMenu);
  const ms = markers(n, today);
  const prio = n.effective_priority;
  const due = dueText(n, today);
  return (
    <div
      className={`row ${n.deferred ? "deferred" : ""} ${isEpic(n) ? "epic" : ""}`}
      data-node-id={n.id}
      data-status={n.status}
      style={{ "--depth": row.depth } as CSSProperties}
    >
      {canToggle ? (
        <button
          type="button"
          className="twisty"
          aria-expanded={open}
          aria-label={open ? `Collapse ${n.title}` : `Expand ${n.title}`}
          onClick={() => onToggle(n.id)}
        >
          {open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="twisty" aria-hidden="true" />
      )}
      <button type="button" className="row-main" onClick={() => onOpen(n.id)} {...menu}>
        <span
          className={`status-dot s-${n.status}`}
          title={STATUS_LABEL[n.status]}
          aria-label={STATUS_LABEL[n.status]}
        />
        <span className="row-title">{n.title}</span>
        <span className="row-meta">
          <span className="mono">{spokeId(n.id)}</span>
          {n.kind === "area" && <span className="chip">area</span>}
          <TypeRefinementChips node={n} />
          {prio !== null && (
            <span className={`chip prio-chip p${prio}`} title={`Priority ${prio}`}>
              P{prio}
            </span>
          )}
          {due && <span className="muted">{due}</span>}
          {n.progress && (
            <span className="muted" title="Steps done">
              {n.progress.done}/{n.progress.total}
            </span>
          )}
          {ms.map((m) => (
            <span key={m.key} className={`marker ${m.cls}`} title={m.title}>
              {m.glyph}
            </span>
          ))}
        </span>
      </button>
    </div>
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
