# spokes-view

A read-only web view of a [Spokes](https://github.com/brandonnorsworthy/spokes) to-do tree: pick a Spokes server from a list and see its whole tree as a radial "spokes" graph in the browser, with no LLM or MCP client involved.

## End goal

Spokes keeps one tree of to-dos that models and agents read and write over MCP. Without an MCP client there is no way to look at it. spokes-view is the companion app that lets Brandon (and anyone on his LAN) see and browse that tree directly.

The finished product:

- **Pick a server** from a configured list (home, dev, test copies) and see its tree; the choice is remembered and can be linked to.
- **Radial graph:** the root in the centre, areas and tasks radiating outward, drawn so a tree of tens of thousands of nodes stays usable: only the top levels load at first, branches load when opened, collapsed branches show how much is hidden.
- **Everything at a glance:** status colours, areas apart from tasks, priority rings, markers for claims, stalled claims, questions waiting on the user, due and overdue dates, the focus list, deferrals, repeats, notes, type and stage badges (Spokes 0.4.0+; older servers show none) and the actionable next step of an ordered parent.
- **Details on click:** breadcrumb, every field in readable form (dates in the server's time zone), type and stage (Spokes 0.4.0+), notes and recent events.
- **Focus on click:** clicking a node also turns the whole tree so that node's spoke (and its label) lies horizontal, glides it to the centre and zooms in (to at least 1×, at most 2×). Drag, scroll or a zoom button stops it part-way; **Fit to view** turns the tree back north-up. With reduced motion set, it jumps without animating.
- **Kanban view:** right-click a node (or press the menu key, or use the link in its details) and pick **View Kanban** to see every node beneath it on a board, one column per status (`/?server=<name>&kanban=<id>`). **Group by** switches the columns to stage, plus a No stage column (`&group=stage`). Cards show where they sit below the board's root; clicking one opens its details in a modal.
- **Backlog view:** **View Backlog** in the same menu (or the **Backlog** link in the header, for the whole tree) lists every node beneath it as an indented outline (`/?server=<name>&backlog=<id>`): collapsible branches, a filter by title or `SPOKE-N` plus Type and Stage dropdowns, all keeping each match's parents, and the same details modal. Kanban and Backlog are plain links: a click stays in the tab, Cmd/middle-click opens a new one, and each page links to the other.
- **Live enough:** a refresh button and a cheap automatic refresh (ETag/304) that keeps the view, expanded branches and selection.
- **Replay:** play a branch's (or the whole tree's) history from its first event, watching it grow, move, get claimed and finish, with each change glowing where it happened.
- **Find anything:** type part of a name (typos, aliases and words from the notes count) and jump to the node, wherever it is in the tree; filter by status, priority, due date and claims; link straight to a node.
- **Later:** editing from the UI, authentication, and viewing other trees with the same shape (such as a future Preferences MCP).

It is for one person and the agents working for him, on a home network.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 0, read-only viewer** | One Rust service serving the page and proxying the Spokes read API (0.2.0+); server list from the environment; radial graph with lazy branches, pan/zoom/fit, node appearance and legend, detail panel with notes and events, closed toggle, refresh and 30-second auto-refresh with 304s, server picker (URL + localStorage), clear loading/empty/unreachable/too-old states, phone layout; Docker image, CI, CodeQL, release to GHCR | **Done** (deployed to the homelab 2026-11-15 as `0.1.0`) |
| **Replay** | Replay a subtree's history from Spokes 0.4.0's `/api/history`: play/pause, step, 1×/4×/16×, date scrubber, caption per step; changes glow (node halo and lit branch, coloured by kind, with a key); full blur glow at 1× and when paused, optional at higher speeds; the view follows the growing tree; disabled with a message against Spokes older than 0.4.0 | **Done** (`0.2.0`) |
| Phase 1, find things | Search and filter (by title, status, priority, due, claimed); jump to a node; deep links to a node | **In progress** (**current**): search and jump to a node done in `0.3.0` (needs Spokes 0.5.0); filters and deep links not started |
| Phase 2, edit from the UI | Status changes, add, move, focus, answer questions, through Spokes' write path | Not started |
| Phase 3, access | Authentication, so it can be reached beyond the LAN | Not started |
| Phase 4, other trees | View other trees served with the same API shape (e.g. a Preferences MCP) | Not started |

## How it works

```
browser --(page, /api/servers/{name}/...)--> spokes-view --(GET /api/tree, /api/nodes/{id}, /api/history, /api/search)--> Spokes 0.2.0+
```

- One Rust (axum, tokio) binary. The React front-end (`web/`) is built by Vite and embedded into the binary, so the image is one file.
- Browsers cannot call Spokes directly (Spokes refuses any request with an `Origin` header), so the backend calls it server to server. The browser only ever sends a server **name**; the URLs live in the configuration and never reach the browser, and the backend never fetches a URL the browser supplied.
- No database and no state: everything comes from Spokes on demand.
- **No auth.** Anyone who can reach the port can read every configured tree. Run it on the LAN or a private Tailscale network only.

### The page's API

| Endpoint | What |
| --- | --- |
| `GET /health` | `200 ok` |
| `GET /api/servers` | `{"servers": [{"name", "status", "version", "message"}]}`; each server is probed at once (`GET /api/tree?depth=0`, 3 s): `status` is `ok`, `unreachable`, `too_old` or `error` |
| `GET /api/servers/{name}/tree?root=&depth=&include_closed=` | Spokes' `/api/tree` passed through unchanged (body, `ETag`, gzip when the browser accepts it). `If-None-Match` is forwarded, so an unchanged tree is a `304` |
| `GET /api/servers/{name}/nodes/{id}?include_closed=` | Spokes' `/api/nodes/{id}`, the same way |
| `GET /api/servers/{name}/history?root=` | Spokes' `/api/history` (0.4.0+, the events behind the replay) for the subtree at `root` (default: the whole tree), the same way. A Spokes older than 0.4.0 gives `history_unsupported` |
| `GET /api/servers/{name}/search?q=&limit=&include_closed=&scope=` | Spokes' `/api/search` (0.5.0+, its `search` tool's ranked matches with breadcrumb ids), the same way. `q` is trimmed, 1 to 200 characters with a letter or digit, and sent upstream percent-encoded; `limit` is 1 to 50. A Spokes older than 0.5.0 gives `search_unsupported` |

Every parameter is checked before anything goes upstream: `root` (the history route takes only `root`) and `id` are `SPOKE-12` or `12`, `depth` is 0 to 10, `include_closed` is `true`/`false`/`1`/`0`, unknown or repeated parameters are refused, server names match the configured list (case-insensitive). Upstream calls use a 3 s connect and 15 s total timeout and never follow redirects. Errors are `{"error": "...", "code": "..."}`:

| `code` | Status | When |
| --- | --- | --- |
| `bad_request` | 400 | A parameter failed validation |
| `unknown_server` | 404 | No server with that name is configured |
| `not_found` | 404 | The node is not in that tree (or an unknown endpoint) |
| `unreachable` | 502 | No connection, or a timeout |
| `too_old` | 502 | `/health` answers but `/api` does not: "this Spokes server is older than 0.2.0 and has no read API" |
| `history_unsupported` | 502 | The history route only: Spokes answered "no such endpoint", so it is older than 0.4.0 |
| `search_unsupported` | 502 | The search route only: Spokes answered "no such endpoint", so it is older than 0.5.0 |
| `upstream_error` | 502 | Anything else (a 403 from the server's `SPOKES_ALLOWED_HOSTS`, a 500, ...) |

### Replay

**Replay** (header) replays the selected node's branch, or the whole tree when nothing is selected. It needs Spokes 0.4.0 or later: the button is disabled with a note when the server list reports an older version, and a `history_unsupported` error says the same.

- The page fetches the subtree's history once (`/api/servers/{name}/history?root=`: every node, closed ones too, and every event, oldest first, with moves and status changes already parsed by Spokes) and rebuilds the tree in the browser (`web/src/replay.ts`, pure). A **step** is the events one tool call wrote (same instant, same agent), so a nested plan appears at once.
- What is replayed: which nodes exist, their parent, status, claim and open question. Titles, notes, priority, dates and sibling order show as they are now (the event log keeps no old values). A node moved out of the branch is not shown in that branch's replay. The last step equals the live tree (with the same "Show closed" filter).
- Controls: ⏮ ◀ ⏯ ▶❘ ⏭, speed 1× (1.2 s a step), 4×, 16×, a scrubber, and keys Space, ←/→, Home/End, Esc. Auto-refresh pauses during replay.
- Each change glows for about 2.6 s: a halo on the node and its branch lit from the root, coloured by what happened (added, done, claimed, asked, moved, reopened, dropped, edited; key in the bar). A change to a node hidden by the closed filter lights its nearest drawn ancestor. The newest step keeps a steady ring until the next. The blurred glow runs at 1× and when paused; at 4×/16× a cheaper layered stroke is used unless "Full glow at 4×/16×" is ticked (remembered in `localStorage`).
- The view refits as the tree grows or shrinks, until you pan or zoom.

### Search

The box in the header (press `/` to jump to it) finds nodes with Spokes' own search, so it matches what agents get from the `search` tool: typos, aliases and words in the notes count, and the best matches come first. It needs Spokes 0.5.0 or later; against an older server the box is disabled with that note.

- Results appear as you type (150 ms after the last key; a newer query cancels the one in flight), up to 10, each with a status dot (a square for areas), the title, its id and breadcrumb, and why it matched when the title did not (`alias "nas"`, `in notes`). `+N more` says when to add words. "Show closed" decides whether done and dropped nodes are searched too; when closed matches are hidden the list says so.
- ↑/↓ move, Enter or a click picks, Esc clears and closes the list (the detail panel stays open).
- Picking a node loads the branches down to it that are not loaded yet (one `tree` request per gap, using the result's breadcrumb ids), opens them, selects the node (detail panel), centres the view on it and lights it and its branch once. The search box is disabled during replay.

### The graph

- **Layout** (`web/src/layout.ts`, hand-written, no graph library): rings by depth; a crowded ring is pushed out until its nodes fit; each node's wedge of angle is in proportion to what its visible subtree needs, so nodes on one ring are never closer than a fixed spacing. Linear in the visible node count; it runs only when the visible set changes. Edges are straight spokes from the root and "elbows" (out, along the circle between two rings, out) deeper down, so they never cut across the centre.
- **Big trees:** the first load is the top 3 levels (Spokes caps a slice at 2000 nodes); the page opens levels while it stays under about 150 drawn nodes. Opening a node whose children are not loaded fetches that branch (2 levels). A collapsed node shows `+N` (all nodes hidden beneath it). **Expand all** opens every branch, fetching the ones not loaded yet (10 levels per branch), and stops at 3,000 drawn nodes with a notice; **Collapse all** returns to the root and its children. Children cut by the 2000-node cap show as `(+N not loaded)`. Pan and zoom move only a composited layer while the gesture runs, and the SVG is redrawn once it stops, so a frame costs the same with 20 nodes or 2,500. Labels keep a constant size on screen and show only when their wedge has room for them.
- **Refresh:** every loaded slice is re-requested with its ETag every 30 s (while the tab is visible) and on the Refresh button; unchanged slices cost a 304. Expanded branches, pan/zoom and the selected node are kept. The header shows when the data last changed and when it was last checked.

## Running locally

Needs the Rust toolchain (`~/.cargo/bin`) and Node 26 / npm.

```sh
cd web && npm ci && npm run build && cd ..
SPOKES_VIEW_SERVERS="Dev=http://127.0.0.1:8787" cargo run --release
# open http://127.0.0.1:8788
```

The release binary embeds `web/dist` at compile time, so build the front-end first. A debug build (`cargo run`) reads `web/dist` from disk instead, so `npm run build` is picked up without recompiling. For front-end work, `npm run dev` in `web/` serves the page with hot reload and proxies `/api` to a backend on `127.0.0.1:8788`.

## Configuration

Environment variables only (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPOKES_VIEW_SERVERS` | (required) | The Spokes servers to offer, `Name=URL` pairs separated by commas, in picker order, e.g. `Home=http://192.168.5.100:10050,Dev=http://127.0.0.1:8787`. Names: up to 40 letters, digits, spaces, `-`, `_`, `.`, unique ignoring case. URLs: `http`/`https`, no user info, query or fragment; a path prefix is allowed. A malformed list stops startup with a message naming the bad entry |
| `SPOKES_VIEW_BIND` | `127.0.0.1:8788` (image: `0.0.0.0:8788`) | Listen address |
| `SPOKES_VIEW_LOG` | `info` | `error`, `warn`, `info` (one line per request, including `status=304`), `debug` or `trace` |

The Spokes servers need no change: spokes-view sends no `Origin`. If a server sets `SPOKES_ALLOWED_HOSTS`, the `Host` spokes-view sends (the one in its URL) must be in that list.

## Docker

```sh
docker build -t spokes-view:dev .
docker run -d --name spokes-view -p 8788:8788 \
  -e SPOKES_VIEW_SERVERS="Home=http://192.168.5.100:10050" spokes-view:dev
```

The image is distroless (no shell), runs as uid 65532, has no volume (no state) and a `HEALTHCHECK` that runs `spokes-view healthcheck` (probes `/health` on `SPOKES_VIEW_BIND`). Ports and the server list are chosen by whoever deploys it (the compose file in `stacks/`), not by this repo.

## Development

Turn the version hooks on once per clone:

```sh
git config core.hooksPath .githooks
```

They bump the version in `Cargo.toml` and `Cargo.lock` (the only version; `web/package.json` stays `0.0.0`) from the commit message and fold it into the commit: `feat:` bumps the minor version, `feat!:` (any `type!:`, or a `BREAKING CHANGE:` line) the major, any other commit that changes code the patch. Commits that touch only docs, `.github/` or `.githooks/` do not bump. CI fails a pull request that changes code without changing the version.

Checks (all run in CI):

```sh
cd web
npm ci
npm run lint          # ESLint (typescript-eslint strict, react-hooks)
npm run format:check  # Prettier
npm run typecheck     # tsc --noEmit (strict)
npm test              # Vitest: layout, tree merging, formatting
npm run build         # web/dist
cd ..
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

`tests/proxy.rs` starts the real service on a random port against stub Spokes servers (a 0.2.0 with `/api`, a 0.1.0 with only `/health`, and a dead address) and checks: the server list and its states (with no URLs leaked), tree pass-through with canonical parameters, 304 pass-through, that a browser's `Origin` is never forwarded, node detail and not-found, unknown server names (no upstream call), unreachable and too-old servers, and that every bad parameter is refused before any upstream call. The search route is checked the same way: canonical upstream parameters with the query percent-encoded, 304 pass-through, no `Origin` forwarded, unknown scope, `search_unsupported` from an older Spokes, and every bad parameter refused before any upstream call. Unit tests cover config parsing, id/depth/boolean parsing, percent-encoding and gzip negotiation. The front-end tests cover replay (moves, claims, recurrence, the closed filter, the last step equalling the live tree, step grouping and glow kinds), the radial layout (spacing on every ring, wedges, thousands of nodes, cycles), merging slices, finding the branches to load on the way to a search result, and date and time formatting.

## CI and releases

- `.github/workflows/ci.yml` (check name `ci`): `npm ci`, ESLint, Prettier, `tsc`, Vitest, the front-end build, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --locked` and a non-pushing `docker build`, on every PR, push to `main` and weekly. On PRs: dependency review and the version-bump check.
- `.github/workflows/codeql.yml`: CodeQL for Rust, JavaScript/TypeScript and the workflows, on PRs, `main` and weekly.
- `.github/workflows/release.yml`: on push to `main` and on `v*` tags, reruns `ci`, then builds and pushes `ghcr.io/brandonnorsworthy/spokes-view` (`latest` and `sha-<short>` from `main`; `X.Y.Z` and `sha-<short>` from a tag) and scans it with Trivy (HIGH/CRITICAL fail the job).
- `.github/dependabot.yml`: weekly cargo, npm (`/web`), GitHub Actions and Docker base image updates. Actions are pinned to commit SHAs.

Release process: push to `main`, wait for green, then tag that commit `vX.Y.Z` with the version it carries (written by the hooks) and push the tag.

## Layout

| Path | What |
| --- | --- |
| `src/main.rs` | Process entry: logging, signals, the `healthcheck` subcommand |
| `src/config.rs` | Environment variables, the server list parser |
| `src/lib.rs` | The axum app: `/health`, `/api`, the page; request log; security headers (CSP `'self'` only) |
| `src/api.rs` | The page's API: validation, server lookup, pass-through, errors |
| `src/upstream.rs` | Calls to Spokes: timeouts, too-old and unreachable detection, the probe |
| `src/assets.rs` | The embedded `web/dist` |
| `tests/proxy.rs` | Integration tests against stub Spokes servers |
| `web/src/App.tsx` | State: server picker, slices, expansion, refresh, detail |
| `web/src/Graph.tsx` | The SVG graph: nodes, edges, labels, pan/zoom/fit, click-to-focus, keyboard |
| `web/src/focus.ts` | Click-to-focus maths: target view (turn, centre, zoom), animation path, label flipping under a turn |
| `web/src/layout.ts` | The radial layout (pure function) |
| `web/src/treeStore.ts` | Merging loaded slices into one tree (pure) |
| `web/src/DetailPanel.tsx`, `web/src/Legend.tsx` | Detail panel and legend |
| `web/src/Search.tsx` | The search box and its result list |
| `web/src/replay.ts`, `web/src/ReplayBar.tsx` | Replay: rebuilding the tree at each step (pure), and the replay bar |
| `web/src/TypeStageChips.tsx` | Type and stage chips for Backlog rows, Kanban cards and details |
| `web/src/format.ts`, `web/src/api.ts`, `web/src/types.ts` | Formatting and markers, the API client, API types |
