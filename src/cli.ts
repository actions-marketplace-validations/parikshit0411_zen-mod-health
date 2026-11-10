#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyzeCss, type Analysis } from "./analyze.js";
import { modBadge, storeBadge } from "./badge.js";
import { loadCorpus, type Corpus } from "./corpus.js";
import { toHtml } from "./html.js";
import { annotation, findings, readLocalMod } from "./local.js";
import { buildReport, toMarkdown, type ModResult } from "./report.js";
import { fetchModCss, fetchStore, mapLimit } from "./store.js";
import { Suggester } from "./suggest.js";
import { defaultCacheDir, downloadZen, findInstalledZen } from "./zen.js";

const HELP = `zen-mod-health — find Zen Browser mods broken by browser updates

Check your own mod:
  npx zen-mod-health chrome.css            (or a mod folder containing chrome.css)

Check every mod in the Zen theme store:
  npx zen-mod-health --store --out reports

Options:
  --zen <dir>           Zen install directory (contains omni.ja). Also: ZEN_DIR.
                        Default: a local install if found, otherwise download.
  --zen-version <tag>   Download and check against this Zen release ("latest").
  --fail-on <level>     Exit 1 at this level: none | broken | degraded
                        (default: degraded for your own files, none for --store)
  --badge <file.svg>    Write a health badge for the checked file
  --json                Print results as JSON
  --out <dir>           Store mode: where to write the report (default: reports)
  --only <text>         Store mode: only mods whose name contains this text
  --offline             Store mode: use cached store data only
  --cache <dir>         Cache directory (default: ${defaultCacheDir()})
  -v, --version         Print version
  -h, --help            Show this help

Exit codes: 0 ok · 1 problems at or above --fail-on · 2 tool error`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    store: { type: "boolean", default: false },
    zen: { type: "string" },
    "zen-version": { type: "string" },
    "fail-on": { type: "string" },
    "fail-on-broken": { type: "boolean", default: false }, // kept for compatibility
    badge: { type: "string" },
    json: { type: "boolean", default: false },
    out: { type: "string", default: "reports" },
    only: { type: "string" },
    offline: { type: "boolean", default: false },
    cache: { type: "string", default: defaultCacheDir() },
    version: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const LEVELS = ["none", "broken", "degraded"] as const;
type FailOn = (typeof LEVELS)[number];

function failsAt(status: Analysis["status"], failOn: FailOn): boolean {
  if (failOn === "none") return false;
  if (status === "broken" || status === "error") return true;
  return failOn === "degraded" && status === "degraded";
}

/** Logs go to stderr in --json mode so stdout stays machine-readable. */
const log = (...a: unknown[]) => (values.json ? console.error(...a) : console.log(...a));

async function resolveCorpus(): Promise<Corpus> {
  const cache = values.cache!;
  let dir = values.zen ?? process.env.ZEN_DIR;
  if (!dir && values["zen-version"]) dir = await downloadZen(values["zen-version"], cache, log);
  dir ??= findInstalledZen();
  dir ??= await downloadZen("latest", cache, log);
  const corpus = loadCorpus(dir, cache);
  log(`Zen ${corpus.version}: ${corpus.tokens.size.toLocaleString("en")} UI names indexed`);
  return corpus;
}

const ICON: Record<Analysis["status"], string> = { healthy: "🟢", degraded: "🟡", broken: "🔴", error: "⚠️", empty: "⚪" };

async function checkLocal(paths: string[], failOn: FailOn): Promise<number> {
  const corpus = await resolveCorpus();
  const suggester = new Suggester(corpus.tokens);
  const inCI = process.env.GITHUB_ACTIONS === "true";
  const results = [];
  let failed = false;

  for (const p of paths) {
    const mod = readLocalMod(p);
    const a = analyzeCss(mod.css, corpus, suggester);
    const fs = findings(a);
    results.push({ name: mod.name, file: mod.file, analysis: a, findings: fs });
    failed ||= failsAt(a.status, failOn);

    log(`\n${ICON[a.status]} ${mod.name} — ${a.status}, ${a.score}/100 (${a.deadRules.length}/${a.totalRules} rules dead)`);
    for (const f of fs) {
      log(`  ${mod.file}:${f.line}  ${f.level === "error" ? "error  " : "warning"}  ${f.message}`);
      if (inCI) console.log(annotation(f, mod.file));
    }
    if (a.error) log(`  ${a.error}`);
  }

  if (values.badge) {
    if (results.length !== 1) throw new Error("--badge needs exactly one mod");
    writeFileSync(values.badge, modBadge(results[0].analysis, corpus.version));
    log(`\nBadge written to ${values.badge}`);
  }
  if (values.json) console.log(JSON.stringify({ zenVersion: corpus.version, results }, null, 2));
  return failed ? 1 : 0;
}

async function checkStore(failOn: FailOn): Promise<number> {
  const t0 = Date.now();
  const corpus = await resolveCorpus();
  const suggester = new Suggester(corpus.tokens);
  const fetchOpts = { cacheDir: join(values.cache!, "store"), offline: values.offline };
  let mods = await fetchStore(fetchOpts);
  if (values.only) mods = mods.filter((m) => m.name.toLowerCase().includes(values.only!.toLowerCase()));
  log(`Checking ${mods.length} mods from the Zen theme store …`);

  const results: ModResult[] = await mapLimit(mods, 8, async (mod) => {
    const meta = { id: mod.id, name: mod.name, author: mod.author, homepage: mod.homepage, updatedAt: mod.updatedAt, style: mod.style };
    try {
      return { mod: meta, analysis: analyzeCss(await fetchModCss(mod, fetchOpts), corpus, suggester) };
    } catch (e) {
      const analysis: Analysis = { totalRules: 0, deadRules: [], missing: [], warnings: [], score: 0, status: "error", error: (e as Error).message };
      return { mod: meta, analysis };
    }
  });

  const report = buildReport(corpus.version, corpus.files, results);
  const out = values.out!;
  mkdirSync(join(out, "badges"), { recursive: true });
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "REPORT.md"), toMarkdown(report));
  writeFileSync(join(out, "index.html"), toHtml(report));
  writeFileSync(join(out, "badge.svg"), storeBadge(report.summary.healthy, report.summary.total - report.summary.empty));
  for (const r of report.results) writeFileSync(join(out, "badges", `${r.mod.id}.svg`), modBadge(r.analysis, corpus.version));

  const s = report.summary;
  log(`\n🟢 ${s.healthy} healthy  🟡 ${s.degraded} degraded  🔴 ${s.broken} broken  ⚠️ ${s.error} errors  ⚪ ${s.empty} empty`);
  for (const r of report.results.filter((r) => r.analysis.status === "broken" || r.analysis.status === "degraded")) {
    log(`  ${ICON[r.analysis.status]} ${r.analysis.score.toString().padStart(3)}  ${r.mod.name}  (${r.analysis.deadRules.length}/${r.analysis.totalRules} rules dead)`);
  }
  log(`\nReport written to ${out}/ in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (values.json) console.log(JSON.stringify(report, null, 2));
  return report.results.some((r) => failsAt(r.analysis.status, failOn)) ? 1 : 0;
}

async function main(): Promise<number> {
  if (values.help) return (console.log(HELP), 0);
  if (values.version) {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
    return (console.log(pkg.version), 0);
  }
  const storeMode = values.store || positionals.length === 0;
  const failOn = (values["fail-on"] ?? (values["fail-on-broken"] ? "broken" : storeMode ? "none" : "degraded")) as FailOn;
  if (!LEVELS.includes(failOn)) throw new Error(`--fail-on must be one of: ${LEVELS.join(", ")}`);
  return storeMode ? checkStore(failOn) : checkLocal(positionals, failOn);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`zen-mod-health: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  },
);
