// Shared kit for the spokes-view mockups (SPOKE-1019): design tokens, sample data from the
// live tree, the bottom tab bar, bottom sheets (details, actions, filters) and long-press.
// Plain JS, no build step; each screen loads Tailwind's CDN, then this file.

/* ---------- Tokens (CSS variables, light + dark) ---------- */
const TOKENS = `
:root{
  --bg:11 13 20; --surface:20 23 34; --surface-2:28 32 47; --line:44 49 68;
  --text:230 233 242; --muted:150 158 184; --accent:122 162 247;
  --open:122 162 247; --prog:224 175 104; --wait:187 154 247; --done:158 206 106; --dropped:115 122 148;
  --alert:247 118 142; --next:115 218 202;
  --t-bug:247 118 142; --t-feature:122 162 247; --t-chore:143 151 179; --t-idea:224 175 104; --t-epic:187 154 247; --t-spike:42 195 222;
  --r-idea:143 151 179; --r-brainstormed:125 207 255; --r-understood:115 218 202; --r-planned:187 154 247; --r-ready:158 206 106;
  color-scheme: dark;
}
@media (prefers-color-scheme: light){:root{
  --bg:244 245 250; --surface:255 255 255; --surface-2:236 239 246; --line:214 219 232;
  --text:24 28 42; --muted:83 91 117; --accent:47 95 208;
  --open:47 98 214; --prog:168 101 10; --wait:123 79 209; --done:47 125 34; --dropped:122 129 153;
  --alert:196 33 61; --next:11 138 120;
  --t-bug:196 33 61; --t-feature:47 95 208; --t-chore:107 115 144; --t-idea:168 101 10; --t-epic:123 79 209; --t-spike:11 110 132;
  --r-idea:84 91 118; --r-brainstormed:11 95 145; --r-understood:8 100 86; --r-planned:106 63 192; --r-ready:38 104 27;
  color-scheme: light;
}}
html,body{background:rgb(var(--bg));color:rgb(var(--text));-webkit-tap-highlight-color:transparent}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-feature-settings:"cv11","ss01"}
.glass{background:rgb(var(--surface) / .78);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4)}
.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}
.sheet{transition:none}.ready .sheet{transition:transform .32s cubic-bezier(.2,.8,.2,1)}
.sheet:not([style*=translate]){visibility:hidden}.ready .sheet{visibility:visible}
.backdrop{transition:opacity .25s}
.press{transition:transform .12s, background-color .15s}.press:active{transform:scale(.97)}
.lp-ring{animation:lp .45s linear forwards}@keyframes lp{from{box-shadow:0 0 0 0 rgb(var(--accent)/.0)}to{box-shadow:0 0 0 4px rgb(var(--accent)/.45)}}
@media (prefers-reduced-motion: reduce){.sheet,.backdrop,.press{transition:none}.lp-ring{animation:none}}
/* Phone frame when the mockup is opened on a desktop screen. */
@media (min-width: 700px){
  body.phone{display:grid;place-items:center;min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%, rgb(var(--accent)/.18), transparent), rgb(var(--bg))}
  body.phone > #app{width:390px;height:844px;border-radius:44px;overflow:hidden;position:relative;box-shadow:0 0 0 10px rgb(var(--surface-2)),0 30px 80px rgb(0 0 0/.5);transform:translateZ(0)}
}
body.phone > #app{position:relative;height:100dvh;overflow:hidden}
`;
document.head.insertAdjacentHTML(
  "beforeend",
  `<link rel="preconnect" href="https://rsms.me/"><link rel="stylesheet" href="https://rsms.me/inter/inter.css"><style>${TOKENS}</style>`,
);

const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
tailwind.config = {
  theme: {
    extend: {
      colors: {
        bg: v("bg"), surface: v("surface"), surface2: v("surface-2"), line: v("line"),
        ink: v("text"), muted: v("muted"), accent: v("accent"),
        open: v("open"), prog: v("prog"), wait: v("wait"), done: v("done"), dropped: v("dropped"),
        alert: v("alert"), next: v("next"),
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
};

/* ---------- Sample data (real titles from the live tree, 2026-11-26) ---------- */
const DATA = [
  { id: 1017, t: "Epic: mobile-first design overhaul of Spokes View", s: "in_progress", ty: "epic", r: "planned", path: "Spokes View", prog: [2, 22] },
  { id: 1019, t: "Design mobile-first mockups for every view and get Brandon's approval", s: "in_progress", ty: "feature", r: "planned", path: "Spokes View › Mobile-first epic", claim: "opus-mobile" },
  { id: 954, t: "Name the pass that writes the mesh arguments at 0xd65e4c000", s: "in_progress", ty: "spike", p: 1, path: "Compatibility layer › Playable on Linux", claim: "opus-blue" },
  { id: 1008, t: "6.6 Bench proof of the whole geometry path: culling chain in frame order", s: "in_progress", ty: "feature", r: "planned", p: 1, path: "Compatibility layer › Playable on Linux" },
  { id: 1009, t: "6.7 First world pixels in the game: proven chain plus mesh and pixel pairs", s: "in_progress", ty: "feature", r: "understood", p: 1, path: "Compatibility layer › Playable on Linux" },
  { id: 37, t: "Add the main ruleset to the Spokes GitHub repo and merge Dependabot PR #1", s: "open", ty: "chore", r: "planned", path: "Spokes" },
  { id: 54, t: "Make Claude break tasks into subtasks by default", s: "open", ty: "chore", r: "understood", path: "Spokes" },
  { id: 148, t: "Bring over ogl33t's fork changes into spokes", s: "open", ty: "feature", r: "understood", path: "Spokes" },
  { id: 151, t: "Add Tailscale so Claude (iOS) can reach the Spokes MCP server remotely", s: "open", ty: "chore", r: "understood", path: "Spokes" },
  { id: 179, t: "Scoped access: lock an agent's view to one subtree with a passphrase", s: "open", ty: "idea", r: "understood", path: "Spokes" },
  { id: 184, t: "add: warn about likely duplicates in the add response", s: "open", ty: "feature", r: "understood", path: "Spokes › agent-feedback" },
  { id: 210, t: "update/set_status: echo the old and new value in the reply", s: "open", ty: "feature", r: "understood", p: 3, path: "Spokes › agent-feedback" },
  { id: 222, t: "add: honor or reject unknown fields on nested children", s: "open", ty: "bug", r: "understood", path: "Spokes › agent-feedback" },
  { id: 236, t: "Dependencies: let a task be blocked by another task", s: "open", ty: "feature", r: "understood", path: "Spokes › agent-feedback" },
  { id: 270, t: "get: show created date and creator (agent) for a node", s: "open", ty: "feature", r: "understood", path: "Spokes › agent-feedback" },
  { id: 998, t: "Bug: refreshing the page on a kanban board resets the filters", s: "open", ty: "bug", r: "planned", path: "Spokes View › Release A" },
  { id: 1022, t: "Kanban on mobile: one column at a time with swipeable column tabs and counts", s: "open", ty: "feature", r: "planned", path: "Spokes View › Release B" },
  { id: 700, t: "Isolate view: re-centre the tree on a node, with an exit button", s: "open", ty: "feature", r: "planned", path: "Spokes View › Release C" },
  { id: 979, t: "Tracked epics: open a \"Tracked\" list on any device", s: "open", ty: "feature", r: "planned", p: 1, path: "Spokes View › Release E" },
  { id: 1035, t: "Desktop board: collapsible columns and a cap with 'show N more'", s: "open", ty: "feature", r: "planned", path: "Spokes View › Release B" },
];
const byId = Object.fromEntries(DATA.map((n) => [n.id, n]));

/* ---------- Small pieces ---------- */
const ICON = {
  bug: '<ellipse cx="8" cy="10" rx="3" ry="4"/><circle cx="8" cy="4.5" r="1.5"/><path d="M5 8 2.5 6.5M5 10.5H2M11 8l2.5-1.5M11 10.5h3"/>',
  feature: '<path d="M8 1.5Q8 8 14.5 8 8 8 8 14.5 8 8 1.5 8 8 8 8 1.5Z"/>',
  chore: '<path d="M10 2.5a3 3 0 0 0-3.6 3.9L2.5 10.3a1.4 1.4 0 0 0 2 2l3.9-3.9A3 3 0 0 0 12.3 4.8l-1.8 1.8-1.4-.3-.3-1.4Z"/>',
  idea: '<path d="M6 11v-.7C6 9.3 4 8.3 4 6a4 4 0 0 1 8 0c0 2.3-2 3.3-2 4.3v.7Z"/><path d="M6.5 13h3"/>',
  epic: '<path d="M1.5 14 6.5 6 9 10l1.5-2 4 6Z"/><path d="M6.5 6V1.5l3 1-3 1"/>',
  spike: '<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5"/>',
};
const svg = (paths, cls = "w-4 h-4") =>
  `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const UI = {
  tree: '<circle cx="8" cy="8" r="2"/><path d="M8 6V2M8 10v4M6 8H2M10 8h4M9.4 6.6l2.6-2.6M6.6 9.4 4 12"/>',
  board: '<rect x="1.5" y="2" width="3.5" height="12" rx="1"/><rect x="6.25" y="2" width="3.5" height="8" rx="1"/><rect x="11" y="2" width="3.5" height="10" rx="1"/>',
  backlog: '<path d="M2 3h12M4.5 8H14M7 13h7"/><circle cx="2" cy="8" r=".4"/><circle cx="4.5" cy="13" r=".4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  tracked: '<path d="M4 1.8h8v12.4l-4-3-4 3Z"/>',
  more: '<circle cx="3" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="13" cy="8" r=".8"/>',
  filter: '<path d="M2 3.5h12M4.5 8h7M7 12.5h2"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  copy: '<rect x="5" y="5" width="9" height="9" rx="2"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>',
  link: '<path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.7.7M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.7-.7"/>',
  expand: '<path d="M8 2v12M2 8h12"/><path d="m5 5 3-3 3 3M5 11l3 3 3-3"/>',
  isolate: '<circle cx="8" cy="8" r="2.5"/><path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2"/>',
  chevron: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
};
const STATUS = { open: ["Open", "open"], in_progress: ["In progress", "prog"], waiting: ["Waiting", "wait"], done: ["Done", "done"], dropped: ["Dropped", "dropped"] };

function typeChip(ty) {
  if (!ty) return "";
  return `<span class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 h-5 rounded-md" style="color:rgb(var(--t-${ty}));background:rgb(var(--t-${ty})/.12)">${svg(ICON[ty], "w-3 h-3")}${ty}</span>`;
}
function refChip(r) {
  if (!r) return "";
  return `<span class="inline-flex items-center text-[11px] font-medium px-1.5 h-5 rounded-md" style="color:rgb(var(--r-${r}));background:rgb(var(--r-${r})/.12)">${r}</span>`;
}
function prioChip(p) {
  return p ? `<span class="text-[11px] font-semibold px-1.5 h-5 inline-flex items-center rounded-md text-alert bg-alert/10">P${p}</span>` : "";
}

/** A card used on boards and lists. Tap = details, long-press = actions. */
function card(n, { showPath = true } = {}) {
  const st = STATUS[n.s][1];
  const epic = n.ty === "epic";
  return `<article data-node="${n.id}" tabindex="0" class="press relative rounded-2xl bg-surface border ${epic ? "border-[rgb(var(--t-epic)/.5)]" : "border-line/70"} px-3.5 py-3 select-none cursor-pointer" style="${epic ? "background:linear-gradient(135deg,rgb(var(--t-epic)/.14),rgb(var(--surface)) 60%)" : ""}">
    <span class="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-${st}"></span>
    ${showPath ? `<div class="text-[11px] text-muted truncate mb-0.5">${n.path}</div>` : ""}
    <div class="text-[15px] leading-snug ${epic ? "font-semibold" : "font-medium"}">${n.t}</div>
    <div class="flex items-center gap-1.5 mt-2 flex-wrap">
      <span class="font-mono text-[11px] text-muted mr-0.5">${n.id}</span>${typeChip(n.ty)}${refChip(n.r)}${prioChip(n.p)}
      ${n.claim ? `<span class="ml-auto text-[11px] text-prog inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-prog animate-pulse"></span>${n.claim}</span>` : ""}
      ${n.prog ? `<span class="ml-auto text-[11px] text-muted">${n.prog[0]}/${n.prog[1]}</span>` : ""}
    </div>
  </article>`;
}

/* ---------- Shell: one-line header + bottom tab bar ---------- */
function header({ title, crumb, filters = true }) {
  return `<header class="glass absolute top-0 inset-x-0 z-20 border-b border-line/60" style="padding-top:env(safe-area-inset-top)">
    <div class="h-14 px-4 flex items-center gap-3">
      <div class="w-8 h-8 rounded-xl grid place-items-center" style="background:conic-gradient(from 200deg,rgb(var(--accent)),rgb(var(--wait)),rgb(var(--next)),rgb(var(--accent)))"><span class="w-2.5 h-2.5 rounded-full bg-bg"></span></div>
      <div class="min-w-0 flex-1 leading-tight">
        ${crumb ? `<div class="text-[11px] text-muted truncate">${crumb}</div>` : ""}
        <div class="text-[16px] font-semibold truncate">${title}</div>
      </div>
      ${filters ? `<button data-open="filters" class="press w-11 h-11 -mr-2 rounded-full grid place-items-center text-muted hover:text-ink" aria-label="View options">${svg(UI.filter, "w-5 h-5")}</button>` : ""}
    </div>
  </header>`;
}
function tabbar(active) {
  const tabs = [["tree", "Tree", "tree.html"], ["board", "Board", "board.html"], ["backlog", "Backlog", "backlog.html"], ["search", "Search", "search.html"], ["tracked", "Tracked", "tracked.html"]];
  return `<nav class="glass absolute bottom-0 inset-x-0 z-20 border-t border-line/60" style="padding-bottom:max(env(safe-area-inset-bottom),6px)">
    <div class="grid grid-cols-5 h-16">
      ${tabs
        .map(([k, label, href]) => {
          const on = k === active;
          return `<a href="${href}" class="press flex flex-col items-center justify-center gap-1 ${on ? "text-accent" : "text-muted"}">
            <span class="w-12 h-7 rounded-full grid place-items-center ${on ? "bg-accent/15" : ""}">${svg(UI[k], "w-[19px] h-[19px]")}</span>
            <span class="text-[11px] ${on ? "font-semibold" : "font-medium"}">${label}</span></a>`;
        })
        .join("")}
    </div></nav>`;
}

/* ---------- Bottom sheets ---------- */
function sheets() {
  return `
  <div id="backdrop" class="backdrop absolute inset-0 z-30 bg-black/45 opacity-0 pointer-events-none"></div>
  <section id="sheet-actions" class="sheet absolute inset-x-0 bottom-0 z-40 translate-y-full" role="dialog" aria-label="Node actions">
    <div class="mx-2 mb-2 rounded-3xl bg-surface border border-line/70 overflow-hidden" style="margin-bottom:max(env(safe-area-inset-bottom),8px)">
      <div class="flex justify-center pt-2"><span class="w-10 h-1.5 rounded-full bg-line"></span></div>
      <div class="px-5 pt-2 pb-3 border-b border-line/60"><div class="text-[11px] text-muted font-mono" id="act-id"></div><div class="font-semibold text-[15px] leading-snug" id="act-title"></div></div>
      <div class="py-1">
        ${[["board", "View board", "Every task below, by status"], ["backlog", "View backlog", "Indented outline with filters"], ["tree", "Show in tree", "Centre the tree on it"], ["isolate", "Isolate", "Only this branch, with a way back"], ["expand", "Expand all below", "Open every level under it"], ["copy", "Copy ID", ""], ["link", "Copy link", ""]]
          .map(([ic, l, d]) => `<button class="press w-full flex items-center gap-4 px-5 min-h-[52px] text-left hover:bg-surface2"><span class="text-accent">${svg(UI[ic], "w-5 h-5")}</span><span class="flex-1"><span class="block text-[15px] font-medium">${l}</span>${d ? `<span class="block text-[12px] text-muted">${d}</span>` : ""}</span></button>`)
          .join("")}
      </div>
    </div>
    <button data-close class="press mx-2 mb-2 w-[calc(100%-1rem)] h-14 rounded-2xl bg-surface border border-line/70 font-semibold text-[15px]" style="margin-bottom:max(env(safe-area-inset-bottom),8px)">Cancel</button>
  </section>

  <section id="sheet-details" class="sheet absolute inset-x-0 bottom-0 z-40 translate-y-full h-[92%] rounded-t-3xl bg-surface border-t border-line/70 flex flex-col shadow-2xl" role="dialog" aria-label="Details">
    <div data-handle class="pt-2 pb-1 flex justify-center cursor-grab touch-none"><span class="w-10 h-1.5 rounded-full bg-line"></span></div>
    <div data-handle class="px-5 pb-3 touch-none">
      <div class="flex items-center gap-2 text-[12px] text-muted"><span id="det-path" class="truncate flex-1"></span>
        <button data-actions-from-details class="press w-10 h-10 -mr-2 rounded-full grid place-items-center hover:bg-surface2" aria-label="Actions">${svg(UI.more, "w-5 h-5")}</button></div>
      <h2 id="det-title" class="text-[19px] font-semibold leading-snug"></h2>
      <div id="det-chips" class="flex flex-wrap gap-1.5 mt-2"></div>
    </div>
    <div class="flex-1 overflow-y-auto px-5 pb-10 text-[14px]">
      <dl class="grid grid-cols-[7rem_1fr] gap-y-2 py-3 border-y border-line/60" id="det-fields"></dl>
      <h3 class="mt-4 mb-1 text-[12px] uppercase tracking-wider text-muted font-semibold">Source</h3>
      <blockquote class="border-l-2 border-accent/60 pl-3 italic text-ink/90">i want you to do a mobile first design overhaul, like it should be super intuitive, easy, capabile and sexy</blockquote>
      <h3 class="mt-5 mb-1 text-[12px] uppercase tracking-wider text-muted font-semibold">Notes</h3>
      <p class="text-ink/90 leading-relaxed">Goal: redesign Spokes View mobile-first, so the phone is the primary target and desktop is the wide layout of the same design. Every action must be reachable by touch alone.</p>
      <p class="text-ink/90 leading-relaxed mt-2">Order: audit → README → mockups → Release A 0.10.0 → B 0.11.0 → C 0.12.0 → D 0.13.0 → Spokes 0.15.0 → E 0.14.0 → wrap-up.</p>
      <h3 class="mt-5 mb-2 text-[12px] uppercase tracking-wider text-muted font-semibold">Recent events</h3>
      <ol class="space-y-2 text-[13px]">
        <li class="flex gap-2"><span class="w-2 h-2 mt-1.5 rounded-full bg-prog"></span><span><b>opus-mobile</b> claimed it <span class="text-muted">· 2 min ago</span></span></li>
        <li class="flex gap-2"><span class="w-2 h-2 mt-1.5 rounded-full bg-done"></span><span><b>opus-mobile</b> finished SPOKE-1018 <span class="text-muted">· 9 min ago</span></span></li>
        <li class="flex gap-2"><span class="w-2 h-2 mt-1.5 rounded-full bg-open"></span><span><b>opus-mobile</b> added 11 steps <span class="text-muted">· 40 min ago</span></span></li>
      </ol>
    </div>
  </section>

  <section id="sheet-filters" class="sheet absolute inset-x-0 bottom-0 z-40 translate-y-full rounded-t-3xl bg-surface border-t border-line/70" role="dialog" aria-label="View options" style="padding-bottom:max(env(safe-area-inset-bottom),12px)">
    <div class="pt-2 pb-1 flex justify-center"><span class="w-10 h-1.5 rounded-full bg-line"></span></div>
    <div class="px-5 pb-2 flex items-center"><h2 class="text-[17px] font-semibold flex-1">View options</h2><button data-close class="press text-accent font-semibold h-11 px-2">Done</button></div>
    <div class="px-5 space-y-5 pb-4">
      <label class="block"><span class="text-[12px] text-muted font-semibold uppercase tracking-wider">Server</span>
        <div class="mt-1.5 h-12 rounded-xl bg-surface2 flex items-center px-3.5 justify-between"><span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-done"></span>Home <span class="text-muted text-[13px]">0.14.1</span></span>${svg(UI.chevron, "w-4 h-4 rotate-90 text-muted")}</div></label>
      <div><span class="text-[12px] text-muted font-semibold uppercase tracking-wider">Show</span>
        <div class="mt-1.5 rounded-xl bg-surface2 divide-y divide-line/60">
          ${[["Done tasks", false], ["Dropped tasks", false]].map(([l, on]) => `<div class="h-12 px-3.5 flex items-center justify-between"><span>${l}</span><span class="toggle w-12 h-7 rounded-full p-0.5 ${on ? "bg-accent" : "bg-line"}"><span class="block w-6 h-6 rounded-full bg-white shadow ${on ? "translate-x-5" : ""}"></span></span></div>`).join("")}
        </div></div>
      <div id="filters-extra"></div>
      <div class="grid grid-cols-3 gap-2">
        ${["Refresh", "Replay", "Legend"].map((l) => `<button class="press h-12 rounded-xl bg-surface2 font-medium text-[14px]">${l}</button>`).join("")}
      </div>
      <p class="text-[12px] text-muted text-center">Read-only view · changes are made through MCP · updated 05:41</p>
    </div>
  </section>`;
}

/* ---------- Behaviour ---------- */
function mount({ active, title, crumb, body, filtersExtra = "" }) {
  document.body.classList.add("phone");
  document.getElementById("app").innerHTML = header({ title, crumb }) + body + tabbar(active) + sheets();
  document.getElementById("filters-extra").innerHTML = filtersExtra;
  wire();
}

let openSheet = null;
function show(id) {
  hide();
  const el = document.getElementById(`sheet-${id}`);
  el.style.transform = id === "details" ? "translateY(45%)" : "translateY(0)";
  el.dataset.snap = id === "details" ? "half" : "";
  const bd = document.getElementById("backdrop");
  bd.classList.remove("pointer-events-none");
  bd.style.opacity = id === "details" ? ".25" : "1";
  openSheet = el;
}
function hide() {
  if (!openSheet) return;
  openSheet.style.transform = "";
  const bd = document.getElementById("backdrop");
  bd.style.opacity = "0";
  bd.classList.add("pointer-events-none");
  openSheet = null;
}
function fillDetails(n) {
  document.getElementById("det-path").textContent = n.path;
  document.getElementById("det-title").textContent = n.t;
  const [label, st] = STATUS[n.s];
  document.getElementById("det-chips").innerHTML =
    `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 h-5 rounded-md text-${st} bg-${st}/15"><span class="w-1.5 h-1.5 rounded-full bg-${st}"></span>${label}</span>` +
    typeChip(n.ty) + refChip(n.r) + prioChip(n.p);
  document.getElementById("det-fields").innerHTML = [
    ["ID", `<span class="font-mono">SPOKE-${n.id}</span>`],
    ["Status", label],
    ["Claimed by", n.claim || "—"],
    ["Progress", n.prog ? `${n.prog[0]} of ${n.prog[1]} done` : "—"],
    ["Updated", "today 05:39"],
  ].map(([k, val]) => `<dt class="text-muted">${k}</dt><dd>${val}</dd>`).join("");
  document.getElementById("act-id").textContent = `SPOKE-${n.id}`;
  document.getElementById("act-title").textContent = n.t;
}

function wire() {
  const app = document.getElementById("app");
  setTimeout(() => app.classList.add("ready"), 400);
  document.getElementById("backdrop").addEventListener("click", hide);
  app.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", hide));
  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => show(b.dataset.open)));
  app.querySelector("[data-actions-from-details]").addEventListener("click", () => show("actions"));
  app.querySelectorAll(".toggle").forEach((t) => t.addEventListener("click", () => {
    t.classList.toggle("bg-accent"); t.classList.toggle("bg-line"); t.firstElementChild.classList.toggle("translate-x-5");
  }));
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());

  // Tap opens details, long-press (or right-click) opens actions.
  let timer = null, fired = false, start = null;
  app.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("[data-node]");
    if (!el) return;
    fired = false; start = [e.clientX, e.clientY];
    el.classList.add("lp-ring");
    timer = setTimeout(() => { fired = true; el.classList.remove("lp-ring"); fillDetails(byId[el.dataset.node]); navigator.vibrate?.(12); show("actions"); }, 450);
  });
  const cancel = () => { clearTimeout(timer); app.querySelectorAll(".lp-ring").forEach((x) => x.classList.remove("lp-ring")); };
  app.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 8) cancel(); });
  app.addEventListener("pointerup", cancel);
  app.addEventListener("pointercancel", cancel);
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-node]");
    if (!el || fired) return;
    fillDetails(byId[el.dataset.node]); show("details");
  });
  app.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-node]");
    if (!el) return;
    e.preventDefault(); cancel(); fillDetails(byId[el.dataset.node]); show("actions");
  });

  // Details sheet: drag the handle between peek, half and full.
  const det = document.getElementById("sheet-details");
  const SNAP = { peek: 72, half: 45, full: 0 };
  let dragY = null, base = 0;
  det.querySelectorAll("[data-handle]").forEach((h) => h.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragY = e.clientY; base = SNAP[det.dataset.snap || "half"]; det.style.transition = "none"; h.setPointerCapture(e.pointerId);
  }));
  det.addEventListener("pointermove", (e) => {
    if (dragY == null) return;
    const pct = Math.max(0, base + ((e.clientY - dragY) / det.offsetHeight) * 100);
    det.style.transform = `translateY(${pct}%)`;
  });
  det.addEventListener("pointerup", (e) => {
    if (dragY == null) return;
    det.style.transition = "";
    const pct = base + ((e.clientY - dragY) / det.offsetHeight) * 100;
    dragY = null;
    if (pct > 85) return hide();
    const snap = Object.entries(SNAP).sort((a, b) => Math.abs(a[1] - pct) - Math.abs(b[1] - pct))[0][0];
    det.dataset.snap = snap; det.style.transform = `translateY(${SNAP[snap]}%)`;
  });
}
