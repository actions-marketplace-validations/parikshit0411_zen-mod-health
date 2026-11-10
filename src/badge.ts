import type { Analysis } from "./analyze.js";

const COLORS = {
  healthy: "#2ea043",
  degraded: "#d29922",
  broken: "#cf222e",
  error: "#6e7781",
  empty: "#6e7781",
} as const;

/** Rough width of Verdana 11px text, the font shields-style badges use. */
function textWidth(s: string): number {
  let w = 0;
  for (const c of s) w += /[ilj.,:;!|'\s]/.test(c) ? 3.5 : /[mwMW]/.test(c) ? 10 : /[A-Z0-9]/.test(c) ? 7.5 : 6.5;
  return Math.ceil(w);
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A flat, shields.io-style SVG badge. */
export function badgeSvg(label: string, message: string, color: string): string {
  const lw = textWidth(label) + 12;
  const mw = textWidth(message) + 12;
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${xml(label)}: ${xml(message)}">
<title>${xml(label)}: ${xml(message)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${xml(label)}</text><text x="${lw / 2}" y="14">${xml(label)}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${xml(message)}</text><text x="${lw + mw / 2}" y="14">${xml(message)}</text>
</g></svg>
`;
}

export function modBadge(a: Analysis, zenVersion: string): string {
  const message =
    a.status === "error" ? "error" : a.status === "empty" ? "no chrome rules" : a.status === "healthy" ? `healthy · Zen ${zenVersion}` : `${a.score}/100 · Zen ${zenVersion}`;
  return badgeSvg("zen mod health", message, COLORS[a.status]);
}

export function storeBadge(healthy: number, total: number): string {
  const ratio = total ? healthy / total : 0;
  const color = ratio >= 0.9 ? COLORS.healthy : ratio >= 0.7 ? COLORS.degraded : COLORS.broken;
  return badgeSvg("store mods healthy", `${healthy}/${total}`, color);
}
