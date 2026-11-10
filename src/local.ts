import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Analysis } from "./analyze.js";

export interface LocalMod {
  name: string;
  /** Path to the CSS file as given / found. */
  file: string;
  css: string;
}

/**
 * Accept a CSS file or a mod directory. A directory is expected to contain
 * chrome.css (and optionally theme.json, whose name is used for display).
 */
export function readLocalMod(path: string): LocalMod {
  if (!existsSync(path)) throw new Error(`No such file or directory: ${path}`);
  let file = path;
  let dir = dirname(path);
  if (statSync(path).isDirectory()) {
    file = join(path, "chrome.css");
    dir = path;
    if (!existsSync(file)) throw new Error(`${path} has no chrome.css`);
  }
  // Prefer the mod's display name from theme.json next to the CSS.
  let name = basename(statSync(path).isDirectory() ? resolve(path) : path);
  const themeJson = join(dir, "theme.json");
  if (existsSync(themeJson)) {
    try {
      name = (JSON.parse(readFileSync(themeJson, "utf8")) as { name?: string }).name ?? name;
    } catch {
      // Ignore malformed theme.json; it's not what we're checking.
    }
  }
  return { name, file, css: readFileSync(file, "utf8") };
}

const sigil = (k: string) => (k === "id" ? "#" : k === "class" ? "." : "");

/** One finding = one line of output; also emitted as a GitHub annotation in CI. */
export interface Finding {
  level: "error" | "warning";
  line: number;
  message: string;
}

export function findings(a: Analysis): Finding[] {
  const out: Finding[] = [];
  for (const m of a.missing.filter((m) => m.breaking)) {
    const fix = m.suggestion ? ` Did you mean \`${sigil(m.kind)}${m.suggestion}\`?` : "";
    for (const line of m.lines) {
      out.push({ level: "error", line, message: `\`${sigil(m.kind)}${m.name}\` does not exist in this Zen version.${fix}` });
    }
  }
  for (const w of a.warnings) {
    const m = w.match(/^Line (\d+): (.*)$/s);
    out.push({ level: "warning", line: m ? Number(m[1]) : 1, message: m ? m[2] : w });
  }
  return out.sort((x, y) => x.line - y.line);
}

/** GitHub Actions workflow command, so findings appear inline on PRs. */
export function annotation(f: Finding, file: string): string {
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const path = relative(process.cwd(), file).replace(/\\/g, "/");
  return `::${f.level} file=${esc(path)},line=${f.line},title=zen-mod-health::${esc(f.message)}`;
}
