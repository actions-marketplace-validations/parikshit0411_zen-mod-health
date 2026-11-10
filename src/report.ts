import type { Analysis } from "./analyze.js";
import type { StoreMod } from "./store.js";

export interface ModResult {
  mod: Pick<StoreMod, "id" | "name" | "author" | "homepage" | "updatedAt" | "style">;
  analysis: Analysis;
}

export interface Report {
  generatedAt: string;
  zenVersion: string;
  corpusFiles: number;
  summary: Record<Analysis["status"], number> & { total: number };
  results: ModResult[];
}

const ORDER: Analysis["status"][] = ["broken", "degraded", "error", "healthy", "empty"];
const ICON: Record<Analysis["status"], string> = {
  broken: "🔴", degraded: "🟡", error: "⚠️", healthy: "🟢", empty: "⚪",
};

export function buildReport(zenVersion: string, corpusFiles: number, results: ModResult[]): Report {
  const summary = { total: results.length, broken: 0, degraded: 0, error: 0, healthy: 0, empty: 0 };
  for (const r of results) summary[r.analysis.status]++;
  const sorted = [...results].sort(
    (a, b) =>
      ORDER.indexOf(a.analysis.status) - ORDER.indexOf(b.analysis.status) ||
      a.analysis.score - b.analysis.score ||
      a.mod.name.localeCompare(b.mod.name),
  );
  return { generatedAt: new Date().toISOString(), zenVersion, corpusFiles, summary, results: sorted };
}

const sigil = (k: string) => (k === "id" ? "#" : k === "class" ? "." : "");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/`/g, "'");

export function toMarkdown(r: Report): string {
  const s = r.summary;
  const lines = [
    `# Zen Mod Health Report`,
    ``,
    `Checked **${s.total}** mods from the Zen theme store against **Zen ${r.zenVersion}** ` +
      `(${r.corpusFiles} source files) on ${r.generatedAt.slice(0, 10)}.`,
    ``,
    `| Status | Mods |`,
    `|---|---|`,
    `| 🟢 Healthy | ${s.healthy} |`,
    `| 🟡 Degraded (some rules dead) | ${s.degraded} |`,
    `| 🔴 Broken (most rules dead) | ${s.broken} |`,
    `| ⚠️ Error | ${s.error} |`,
    `| ⚪ No chrome rules | ${s.empty} |`,
    ``,
    `## All mods`,
    ``,
    `| | Mod | Score | Dead rules | Last updated |`,
    `|---|---|---|---|---|`,
    ...r.results.map(
      ({ mod, analysis: a }) =>
        `| ${ICON[a.status]} | ${esc(mod.name)} | ${a.score} | ${a.deadRules.length}/${a.totalRules} | ${mod.updatedAt?.slice(0, 10) ?? "?"} |`,
    ),
    ``,
    `## Details`,
  ];
  for (const { mod, analysis: a } of r.results) {
    const stale = a.missing.some((m) => m.breaking);
    if (a.status === "healthy" && a.warnings.length === 0 && !stale) continue;
    if (a.status === "empty" && a.warnings.length === 0) continue;
    lines.push(``, `### ${ICON[a.status]} ${mod.name} — ${a.score}/100`, ``);
    if (a.error) lines.push(`- Error: ${a.error}`);
    for (const w of a.warnings) lines.push(`- ⚠️ ${w}`);
    const breaking = a.missing.filter((m) => m.breaking);
    if (breaking.length) {
      lines.push(`- Names no longer in Zen:`);
      for (const m of breaking) {
        const fix = m.suggestion ? ` → did you mean \`${sigil(m.kind)}${m.suggestion}\`?` : "";
        lines.push(`  - \`${sigil(m.kind)}${m.name}\` (line ${m.lines.join(", ")})${fix}`);
      }
    }
    if (a.deadRules.length) {
      lines.push(``, `<details><summary>${a.deadRules.length} dead rule(s)</summary>`, ``);
      for (const d of a.deadRules.slice(0, 50)) lines.push(`- L${d.line}: \`${esc(d.selector).slice(0, 160)}\``);
      if (a.deadRules.length > 50) lines.push(`- …and ${a.deadRules.length - 50} more`);
      lines.push(``, `</details>`);
    }
  }
  return lines.join("\n") + "\n";
}
