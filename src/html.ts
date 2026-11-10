import type { Report } from "./report.js";

/** Render a self-contained HTML dashboard (no external requests). */
export function toHtml(report: Report): string {
  // Escape "<" so mod-provided strings can't close the <script> tag.
  const data = JSON.stringify(report).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zen Mod Health</title>
<style>
  :root {
    --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --card: #fff; --line: #e7e5e4;
    --ok: #15803d; --warn: #b45309; --bad: #b91c1c; --info: #57534e; --accent: #f76f53;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --card: #292524; --line: #44403c;
      --ok: #4ade80; --warn: #fbbf24; --bad: #f87171; --info: #a8a29e; color-scheme: dark; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .tile[aria-pressed="true"] { outline: 2px solid var(--accent); }
  .tile b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
  .tile span { color: var(--muted); font-size: 13px; }
  .bar { display: flex; gap: 8px; margin-bottom: 12px; }
  input[type=search] { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); font: inherit; }
  .mod { background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 8px; }
  .mod summary { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 12px; align-items: center; padding: 12px 16px; cursor: pointer; list-style: none; }
  .mod summary::-webkit-details-marker { display: none; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .healthy .dot { background: var(--ok); } .degraded .dot { background: var(--warn); }
  .broken .dot { background: var(--bad); } .error .dot, .empty .dot { background: var(--info); }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .score { font-variant-numeric: tabular-nums; font-weight: 600; }
  .meta { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .body { padding: 0 16px 16px 40px; font-size: 14px; }
  .body h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 12px 0 6px; }
  .body ul { margin: 0; padding-left: 18px; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .fix { color: var(--ok); }
  .badge-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
  .badge-row input { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); font: 12px ui-monospace, monospace; }
  .mod:target { outline: 2px solid var(--accent); }
  a { color: var(--accent); }
  .empty-state { color: var(--muted); padding: 24px; text-align: center; }
  @media (max-width: 560px) { .mod summary { grid-template-columns: 12px 1fr auto; } .meta { display: none; } .body { padding-left: 16px; } }
</style>
</head>
<body>
<main>
  <h1>Zen Mod Health</h1>
  <p class="sub" id="sub"></p>
  <p class="sub">Finds mods whose CSS targets interface elements that no longer exist in Zen. Each mod's
  <code>chrome.css</code> is checked against the names in the latest Zen release.</p>
  <div class="tiles" id="tiles"></div>
  <div class="bar"><input type="search" id="q" placeholder="Search mods or selectors…" aria-label="Search"></div>
  <div id="list"></div>
</main>
<script>
const R = ${data};
const LABEL = { broken: "Broken", degraded: "Degraded", healthy: "Healthy", error: "Errors", empty: "No chrome rules" };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sigil = k => k === "id" ? "#" : k === "class" ? "." : "";
let filter = null;

document.getElementById("sub").textContent =
  R.summary.total + " mods from the Zen theme store checked against Zen " + R.zenVersion +
  " · " + new Date(R.generatedAt).toLocaleString();

function tiles() {
  document.getElementById("tiles").innerHTML = ["broken", "degraded", "healthy", "error"].map(s =>
    '<button class="tile ' + s + '" data-s="' + s + '" aria-pressed="' + (filter === s) + '"><b>' + R.summary[s] +
    '</b><span>' + LABEL[s] + '</span></button>').join("");
  document.querySelectorAll(".tile").forEach(t => t.onclick = () => { filter = filter === t.dataset.s ? null : t.dataset.s; render(); });
}

function detail(a) {
  let h = "";
  if (a.error) h += "<h3>Error</h3><p>" + esc(a.error) + "</p>";
  const gone = a.missing.filter(m => m.breaking);
  if (gone.length) h += "<h3>Names no longer in Zen</h3><ul>" + gone.map(m =>
    "<li><code>" + esc(sigil(m.kind) + m.name) + "</code> — line " + m.lines.join(", ") +
    (m.suggestion ? ' <span class="fix">→ did you mean <code>' + esc(sigil(m.kind) + m.suggestion) + "</code>?</span>" : "") +
    "</li>").join("") + "</ul>";
  if (a.deadRules.length) h += "<h3>Rules that can no longer match (" + a.deadRules.length + ")</h3><ul>" +
    a.deadRules.slice(0, 40).map(d => "<li>L" + d.line + ": <code>" + esc(d.selector.slice(0, 200)) + "</code></li>").join("") +
    (a.deadRules.length > 40 ? "<li>…and " + (a.deadRules.length - 40) + " more</li>" : "") + "</ul>";
  if (a.warnings.length) h += "<h3>Warnings</h3><ul>" + a.warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>";
  return h || "<p>No problems found.</p>";
}

function badgeRow(mod) {
  const url = new URL("badges/" + mod.id + ".svg", location.href).href;
  const md = "[![zen mod health](" + url + ")](" + location.href.split("#")[0] + "#" + mod.id + ")";
  return '<div class="badge-row"><img src="badges/' + esc(mod.id) + '.svg" alt="health badge" height="20">' +
    '<input readonly value="' + esc(md) + '" aria-label="Badge Markdown" onclick="this.select()"></div>';
}

function render() {
  tiles();
  const q = document.getElementById("q").value.trim().toLowerCase();
  const rows = R.results.filter(r => (!filter || r.analysis.status === filter) &&
    (!q || r.mod.name.toLowerCase().includes(q) || r.analysis.missing.some(m => m.name.toLowerCase().includes(q))));
  document.getElementById("list").innerHTML = rows.length ? rows.map(({ mod, analysis: a }) =>
    '<details class="mod ' + a.status + '" id="' + esc(mod.id) + '"' + (location.hash === "#" + mod.id ? " open" : "") + '><summary><span class="dot" title="' + LABEL[a.status] + '"></span>' +
    '<span class="name">' + esc(mod.name) + '</span><span class="score">' + (a.status === "error" ? "—" : a.score) + '</span>' +
    '<span class="meta">updated ' + esc((mod.updatedAt || "?").slice(0, 10)) + '</span></summary>' +
    '<div class="body">' + detail(a) + '<p class="meta">' + a.totalRules + ' rules checked · <a href="' + esc(mod.style) + '">chrome.css</a>' +
    (mod.homepage ? ' · <a href="' + esc(mod.homepage) + '">homepage</a>' : "") + ' · <a href="#' + esc(mod.id) + '">link</a></p>' + badgeRow(mod) +
    '</div></details>').join("") : '<p class="empty-state">No mods match.</p>';
}
document.getElementById("q").oninput = render;
render();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
</script>
</body>
</html>
`;
}
