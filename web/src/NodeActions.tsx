import { useRef, type PointerEvent, type ReactElement, type MouseEvent } from "react";
import { backlogUrl } from "./backlog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { spokeId } from "./format";
import { LONG_PRESS_MS, type MenuVia } from "./Graph";
import { Icon, type IconName } from "./Icon";
import { kanbanUrl } from "./kanban";
import { Sheet } from "./Sheet";

/** One thing you can do with a node. Every action only views; none changes the tree. */
export type Action = MenuItem & { hint?: string; icon?: IconName };

/** The tree page centred on a node (`node=` is read by the tree page). */
export function treeLink(server: string, id: number): string {
  const q = new URLSearchParams({ server, node: String(id) });
  return `/?${q.toString()}`;
}

/** Copy text, falling back to a hidden textarea: the clipboard API needs HTTPS, the LAN has HTTP. */
export function copyText(text: string): boolean {
  try {
    if (window.isSecureContext) {
      void navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    // The only way to copy from a plain-HTTP page (the viewer runs on the LAN without TLS).
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A short message at the bottom of the screen that fades by itself. */
export function toast(text: string): void {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1800);
}

/** The view actions every node has: its board and backlog, the tree, and copying it. */
export function linkActions(
  server: string,
  node: { id: number; child_count: number },
  opts: { tree?: boolean } = {},
): Action[] {
  const id = spokeId(node.id);
  return [
    ...(node.child_count > 0
      ? [
          {
            label: "View board",
            hint: "Every task below, by status",
            icon: "board" as const,
            href: kanbanUrl(server, node.id),
          },
          {
            label: "View backlog",
            hint: "Indented outline with filters",
            icon: "backlog" as const,
            href: backlogUrl(server, node.id),
          },
        ]
      : []),
    ...(opts.tree === false
      ? []
      : [
          {
            label: "Show in tree",
            hint: "Centre the tree on it",
            icon: "tree" as const,
            href: treeLink(server, node.id),
          },
        ]),
    {
      label: "Copy ID",
      icon: "copy",
      onPick: () => toast(copyText(id) ? `Copied ${id}` : "Couldn't copy"),
    },
    {
      label: "Copy link",
      icon: "link",
      onPick: () =>
        toast(
          copyText(new URL(treeLink(server, node.id), window.location.href).href)
            ? "Link copied"
            : "Couldn't copy",
        ),
    },
  ];
}

/** Whether actions open as a bottom sheet: touch, or a narrow or touch-first screen. */
export function wantsSheet(via: MenuVia): boolean {
  if (via === "touch") return true;
  if (via === "key") return false;
  return window.matchMedia("(pointer: coarse), (max-width: 760px)").matches;
}

interface Props {
  via: MenuVia;
  /** Where a pointer menu opens, in viewport pixels. */
  x: number;
  y: number;
  /** The node's id and title, shown at the top. */
  id: number;
  title: string;
  items: Action[];
  onClose: () => void;
}

/** A node's actions: a bottom sheet for touch, a menu at the pointer for a mouse or keys. */
export function NodeActions({ via, x, y, id, title, items, onClose }: Props): ReactElement {
  if (!wantsSheet(via)) {
    return (
      <ContextMenu
        x={x}
        y={y}
        heading={`${spokeId(id)} ${title}`}
        items={items}
        onClose={onClose}
      />
    );
  }
  return (
    <Sheet label={`Actions for ${spokeId(id)}`} onClose={onClose} className="action-sheet">
      <div className="action-head">
        <span className="mono muted">{spokeId(id)}</span>
        <strong>{title}</strong>
      </div>
      <div className="action-list">
        {items.map((item) => {
          const body = (
            <>
              <span className="action-icon">
                {item.icon && <Icon name={item.icon} size="1.25rem" />}
              </span>
              <span className="action-text">
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </span>
            </>
          );
          return "href" in item ? (
            <a key={item.label} className="action" href={item.href} onClick={onClose}>
              {body}
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              className="action"
              onClick={() => {
                onClose();
                item.onPick();
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
      <button type="button" className="action-cancel" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}

/**
 * Long-press and right-click on a card or row: `onMenu` gets the point and how it was
 * asked for. The click that ends a long-press is swallowed so it doesn't also open details.
 */
export function useNodeMenu(onMenu: (x: number, y: number, via: MenuVia) => void): {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
} {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(0);
  const cancel = (): void => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  return {
    onPointerDown: (e) => {
      cancel();
      if (e.pointerType === "mouse") return;
      const { clientX: x, clientY: y } = e;
      start.current = { x, y };
      timer.current = window.setTimeout(() => {
        cancel();
        fired.current = Date.now();
        if ("vibrate" in navigator) navigator.vibrate(10);
        onMenu(x, y, "touch");
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e) => {
      if (Date.now() - fired.current < 1000) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e) => {
      e.preventDefault();
      if (Date.now() - fired.current < 1000) return;
      onMenu(e.clientX, e.clientY, "pointer");
    },
  };
}
