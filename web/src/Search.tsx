import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { ApiError, fetchSearch } from "./api";
import { STATUS_LABEL, spokeId } from "./format";
import type { SearchHit, SearchResponse, Shown } from "./types";

/** Wait after the last keystroke before asking the server. */
const DEBOUNCE_MS = 150;
const LIMIT = 10;

export interface SearchProps {
  server: string | null;
  show: Shown;
  /** False when the server is older than Spokes 0.5.0 (or not ok). */
  supported: boolean;
  disabled: boolean;
  onPick: (hit: SearchHit) => void;
}

type Results =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: SearchResponse }
  | { kind: "error"; message: string };

/** Breadcrumb below the root: `Personal / Development`. */
function pathText(hit: SearchHit): string {
  const below = hit.path.slice(1).map((c) => c.title);
  return below.length > 0 ? below.join(" / ") : "top level";
}

/**
 * The header search box: fuzzy matches from Spokes' own search as you type, picked with
 * the mouse or the arrow keys and Enter. `/` focuses it from anywhere on the page.
 */
export function Search({ server, show, supported, disabled, onPick }: SearchProps): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const off = disabled || !supported || !server;
  /** A query worth sending: it has a letter or digit (Spokes refuses one without). */
  const searchable = !off && /[\p{L}\p{N}]/u.test(query);

  // `/` focuses the box, unless typing somewhere else already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!input.current || input.current.disabled) return;
      e.preventDefault();
      input.current.focus();
      input.current.select();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ask the server once typing pauses; a newer query cancels the one in flight.
  useEffect(() => {
    if (!server || !searchable) return;
    const q = query.trim();
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      setResults((r) => (r.kind === "ready" ? r : { kind: "loading" }));
      fetchSearch(server, q, show, LIMIT, ctl.signal).then(
        (data) => {
          setResults({ kind: "ready", data });
          setActive(0);
        },
        (e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setResults({
            kind: "error",
            message: e instanceof ApiError ? e.message : "search failed",
          });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [query, server, show, searchable]);

  // Results of an earlier query stay up until the new ones arrive.
  const shown: Results = searchable ? results : { kind: "idle" };
  const hits = shown.kind === "ready" ? shown.data.results : [];

  const pick = (hit: SearchHit) => {
    setOpen(false);
    input.current?.blur();
    onPick(hit);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Clears and closes, as a search box does; keep the page's own Escape (closing
      // the panel) out of it.
      e.stopPropagation();
      setQuery("");
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (hits.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + hits.length) % hits.length);
      return;
    }
    if (e.key === "Enter") {
      const hit = hits[active];
      if (hit) {
        e.preventDefault();
        pick(hit);
      }
    }
  };

  const showList = open && shown.kind !== "idle";
  const activeHit = showList ? hits[active] : undefined;

  return (
    <div className="search">
      <input
        ref={input}
        type="search"
        className="search-input"
        placeholder={supported ? "Search  /" : "Search needs Spokes 0.5.0"}
        title={
          supported
            ? "Find a node by name, alias or notes; typos are fine (press / to focus)"
            : "Search needs Spokes 0.5.0 or later on this server"
        }
        aria-label="Search the tree"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeHit ? `${listId}-${String(activeHit.id)}` : undefined}
        value={query}
        disabled={off}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Let a click on a result land before the list closes.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="search-results" role="listbox" id={listId} aria-label="Search results">
          {shown.kind === "loading" && <div className="search-note">Searching…</div>}
          {shown.kind === "error" && <div className="search-note warn">{shown.message}</div>}
          {shown.kind === "ready" && hits.length === 0 && (
            <div className="search-note">
              No matches. Try other words or spellings.
              {shown.data.hidden_closed > 0 &&
                ` ${String(shown.data.hidden_closed)} done or dropped ${shown.data.hidden_closed === 1 ? "match is" : "matches are"} hidden; turn on "Show done" or "Show dropped".`}
            </div>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.id}
              id={`${listId}-${String(hit.id)}`}
              role="option"
              aria-selected={i === active}
              className={`search-hit ${i === active ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span
                className={`search-dot status-${hit.status.replace("_", "-")} ${hit.kind}`}
                title={STATUS_LABEL[hit.status]}
                aria-hidden="true"
              />
              <span className="search-main">
                <span className="search-title">{hit.title}</span>
                <span className="search-path">
                  {spokeId(hit.id)} · {pathText(hit)}
                  {hit.via && <span className="search-via"> · {hit.via}</span>}
                </span>
              </span>
            </div>
          ))}
          {shown.kind === "ready" && shown.data.total > hits.length && (
            <div className="search-note">
              +{shown.data.total - hits.length} more. Add words to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
