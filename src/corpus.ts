import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

/**
 * A "corpus" is the set of every identifier-like token that appears in the
 * browser's shipped UI code (markup, scripts, styles). If a mod's selector
 * references an id/class/element name that appears nowhere in the build,
 * that selector cannot match anything in the browser chrome.
 */
export interface Corpus {
  version: string;
  tokens: Set<string>;
  files: number;
}

/** File types that can define or create chrome elements, ids and classes. */
const SOURCE_EXT = /\.(xhtml|html|xml|inc|js|mjs|css)$/i;
const TOKEN = /[A-Za-z_][A-Za-z0-9_-]*/g;

export function tokenize(text: string, into: Set<string>): void {
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    into.add(t);
    // `foo-bar-` style fragments built in JS (e.g. "zen-tab-" + id) still
    // count as evidence for the prefix; also index trailing-dash-trimmed form.
    if (t.endsWith("-")) into.add(t.replace(/-+$/, ""));
  }
}

export function readVersion(zenDir: string): string {
  const ini = join(zenDir, "application.ini");
  if (!existsSync(ini)) return "unknown";
  const m = readFileSync(ini, "utf8").match(/^Version=(.+)$/m);
  return m ? m[1].trim() : "unknown";
}

/** Locate the omni.ja archives in a Zen install directory. */
export function findArchives(zenDir: string): string[] {
  const candidates = [join(zenDir, "omni.ja"), join(zenDir, "browser", "omni.ja")];
  const found = candidates.filter((p) => existsSync(p));
  if (found.length === 0) {
    throw new Error(`No omni.ja found in "${zenDir}". Pass the Zen install directory with --zen.`);
  }
  return found;
}

export function buildCorpus(zenDir: string): Corpus {
  const tokens = new Set<string>();
  const decoder = new TextDecoder();
  let files = 0;
  for (const archive of findArchives(zenDir)) {
    const entries = unzipSync(readFileSync(archive), {
      filter: (f) => SOURCE_EXT.test(f.name),
    });
    for (const data of Object.values(entries)) {
      tokenize(decoder.decode(data), tokens);
      files++;
    }
  }
  return { version: readVersion(zenDir), tokens, files };
}

/** Build a corpus from in-memory strings (used by tests). */
export function corpusFromText(...texts: string[]): Corpus {
  const tokens = new Set<string>();
  texts.forEach((t) => tokenize(t, tokens));
  return { version: "test", tokens, files: texts.length };
}
