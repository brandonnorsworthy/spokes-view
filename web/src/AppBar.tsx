import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePhone } from "./usePhone";
import { backlogUrl } from "./backlog";
import { Icon, type IconName } from "./Icon";
import { kanbanUrl, treeUrl } from "./kanban";

export type Tab = "tree" | "board" | "backlog" | "search";

interface Props {
  server: string | null;
  /** Which tab this page is. */
  tab: Tab;
  /** The node the Tree, Board and Backlog tabs open (the page's root or selection). */
  nodeId: number;
  /** Small line above the title (where the page sits). */
  crumb?: ReactNode;
  title: ReactNode;
  /**
   * The page's view options (server, filters, refresh...). On a wide screen they sit in
   * the bar; on a phone they move into a sheet behind the options button.
   */
  options: ReactNode;
  /** How fresh the view is ("Updated 05:41"): in the bar, or the sheet's footer on a phone. */
  status?: ReactNode;
  /** Shown in the bar on every screen size, after the title (e.g. the search box). */
  extra?: ReactNode;
  /** The Search tab: a page with its own search opens it, others go to the tree's. */
  onSearch?: () => void;
  searching?: boolean;
}

const TABS: [Tab, string, IconName][] = [
  ["tree", "Tree", "tree"],
  ["board", "Board", "board"],
  ["backlog", "Backlog", "backlog"],
  ["search", "Search", "search"],
];

/**
 * The page header: one line on a phone (logo, where you are, options) with the tabs in a
 * bar at the bottom; on a wide screen the tabs and options sit in the header itself.
 */
export function AppBar({
  server,
  tab,
  nodeId,
  crumb,
  title,
  options,
  status,
  extra,
  onSearch,
  searching = false,
}: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const phone = usePhone();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const hrefFor = (t: Tab): string | undefined => {
    if (!server) return undefined;
    if (t === "tree") return treeUrl(server, nodeId);
    if (t === "board") return kanbanUrl(server, nodeId);
    if (t === "backlog") return backlogUrl(server, nodeId);
    return onSearch ? undefined : `${treeUrl(server, nodeId)}&search=1`;
  };

  // On a phone the options are a bottom sheet rendered at the page level, so nothing on the
  // header (a blur, a transform) can become its containing block and pull it off screen.
  const sheet = (
    <div
      className={`view-options ${open ? "open" : ""}`}
      // A control marked data-close-sheet (Replay, Legend) shows something behind the sheet.
      onClick={(e) => {
        if ((e.target as Element).closest("[data-close-sheet]")) setOpen(false);
      }}
      role={open ? "dialog" : undefined}
      aria-label={open ? "View options" : undefined}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <div className="view-options-head">
        <strong>View options</strong>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
      {options}
      <p className="view-options-note" aria-live="polite">
        Read-only view · changes are made through MCP
        {status && (
          <>
            {" · "}
            {status}
          </>
        )}
      </p>
    </div>
  );

  const tabs = (where: "top" | "bottom") => (
    <nav className={where === "top" ? "tabs-top" : "tabbar"} aria-label="Views">
      {TABS.map(([t, label, icon]) => {
        const active = t === "search" ? searching : t === tab && !searching;
        const href = hrefFor(t);
        const body = (
          <>
            <span className="tab-icon">
              <Icon name={icon} />
            </span>
            <span className="tab-label">{label}</span>
          </>
        );
        // The wide layout keeps its own search box, so it has no Search tab.
        if (where === "top" && t === "search") return null;
        return t === "search" && onSearch ? (
          <button
            key={t}
            type="button"
            className={`tab ${active ? "active" : ""}`}
            aria-pressed={active}
            onClick={onSearch}
          >
            {body}
          </button>
        ) : (
          <a
            key={t}
            className={`tab ${active ? "active" : ""}`}
            href={href}
            aria-current={active ? "page" : undefined}
          >
            {body}
          </a>
        );
      })}
    </nav>
  );

  return (
    <>
      <header className="appbar">
        <a
          className="brand"
          href={server ? `/?server=${encodeURIComponent(server)}` : "/"}
          aria-label="Spokes view home"
        >
          <span className="logo" aria-hidden="true" />
        </a>
        <div className="appbar-title">
          {crumb && <small>{crumb}</small>}
          <strong>{title}</strong>
        </div>
        {tabs("top")}
        {extra}
        {!phone && sheet}
        {!phone && status && (
          <span className="updated" aria-live="polite">
            {status}
          </span>
        )}
        <button
          type="button"
          className="appbar-more"
          aria-label="View options"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="options" size="1.35rem" />
        </button>
      </header>
      {phone && createPortal(sheet, document.body)}
      {open && <div className="sheet-backdrop options-backdrop" onClick={() => setOpen(false)} />}
      {tabs("bottom")}
    </>
  );
}
