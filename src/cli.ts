#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { analyzeCss } from "./analyze.js";
import { buildCorpus } from "./corpus.js";
import { toHtml } from "./html.js";
import { buildReport, toMarkdown, type ModResult } from "./report.js";
import { fetchModCss, fetchStore, mapLimit } from "./store.js";
import { Suggester } from "./suggest.js";

const DEFAULT_ZEN_DIR: Record<string, string> = {
  win32: "C:\\Program Files\\Zen Browser",
  darwin: "/Applications/Zen.app/Contents/Resources",
  linux: "/opt/zen",
};

const { values } = parseArgs({
  options: {
    zen: { type: "string", default: process.env.ZEN_DIR ?? DEFAULT_ZEN_DIR[process.platform] },
    out: { type: "string", default: "reports" },
    cache: { type: "string", default: ".cache" },
    only: { type: "string" },
    offline: { type: "boolean", default: false },
    "fail-on-broken": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`zen-mod-health — find Zen mods broken by browser updates

Usage: zen-mod-health [--zen <install dir>] [--out reports] [--only <name>] [--offline]

  --zen             Zen install directory containing omni.ja (or set ZEN_DIR)
  --out             Output directory for report.json / REPORT.md / index.html
  --only            Only check mods whose name contains this text
  --offline         Use cached store data only
  --fail-on-broken  Exit with code 1 if any mod is broken (for CI)`);
  process.exit(0);
}

async function main() {
  const t0 = Date.now();
  console.log(`Indexing Zen build in ${values.zen} …`);
  const corpus = buildCorpus(values.zen!);
  console.log(`  Zen ${corpus.version}: ${corpus.tokens.size.toLocaleString()} names from ${corpus.files} files`);

  const suggester = new Suggester(corpus.tokens);
  const fetchOpts = { cacheDir: values.cache!, offline: values.offline };
  let mods = await fetchStore(fetchOpts);
  if (values.only) mods = mods.filter((m) => m.name.toLowerCase().includes(values.only!.toLowerCase()));
  console.log(`Checking ${mods.length} mods …`);

  const results: ModResult[] = await mapLimit(mods, 8, async (mod) => {
    const meta = { id: mod.id, name: mod.name, author: mod.author, homepage: mod.homepage, updatedAt: mod.updatedAt, style: mod.style };
    try {
      return { mod: meta, analysis: analyzeCss(await fetchModCss(mod, fetchOpts), corpus, suggester) };
    } catch (e) {
      return {
        mod: meta,
        analysis: { totalRules: 0, deadRules: [], missing: [], warnings: [], score: 0, status: "error", error: (e as Error).message },
      };
    }
  });

  const report = buildReport(corpus.version, corpus.files, results);
  mkdirSync(values.out!, { recursive: true });
  writeFileSync(join(values.out!, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(values.out!, "REPORT.md"), toMarkdown(report));
  writeFileSync(join(values.out!, "index.html"), toHtml(report));

  const s = report.summary;
  console.log(`\n🟢 ${s.healthy} healthy  🟡 ${s.degraded} degraded  🔴 ${s.broken} broken  ⚠️ ${s.error} errors  ⚪ ${s.empty} empty`);
  for (const r of report.results.filter((r) => r.analysis.status === "broken" || r.analysis.status === "degraded")) {
    console.log(`  ${r.analysis.status === "broken" ? "🔴" : "🟡"} ${r.analysis.score.toString().padStart(3)}  ${r.mod.name}  (${r.analysis.deadRules.length}/${r.analysis.totalRules} rules dead)`);
  }
  console.log(`\nReport written to ${values.out}/ in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (values["fail-on-broken"] && s.broken > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
