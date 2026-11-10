import postcss, { type AtRule, type Container, type Root, type Rule } from "postcss";
import safeParse from "postcss-safe-parser";
import selectorParser, { type Selector } from "postcss-selector-parser";
import type { Corpus } from "./corpus.js";
import type { Suggester } from "./suggest.js";

export type TokenKind = "id" | "class" | "element";

export interface MissingToken {
  kind: TokenKind;
  name: string;
  /** Lines (in the mod's chrome.css) where the token is referenced. */
  lines: number[];
  /** true if a reference makes a selector dead; false if only inside :not(). */
  breaking: boolean;
  /** Closest name that does exist in this Zen build, if any. */
  suggestion?: string;
}

export interface DeadRule {
  selector: string;
  line: number;
  /** "selector" = references UI that no longer exists; "parent" = nested in a dead rule */
  reason: "selector" | "parent";
}

export interface Analysis {
  totalRules: number;
  deadRules: DeadRule[];
  missing: MissingToken[];
  warnings: string[];
  /** 0-100: share of rules that can still match something. */
  score: number;
  status: "healthy" | "degraded" | "broken" | "empty" | "error";
  error?: string;
}

/** At-rules whose child "rules" are not chrome selectors. */
const SKIP_AT_RULES = new Set([
  "keyframes", "-moz-keyframes", "-webkit-keyframes",
  "-moz-document", "document", // targets web pages, not the browser UI
  "font-face", "font-feature-values", "page", "property", "counter-style",
]);

/** Functional pseudo-classes whose arguments are alternatives: dead only if all are dead. */
const ALTERNATIVE_PSEUDOS = new Set([":is", ":where", ":matches", ":-moz-any", ":any", ":has"]);

/**
 * Names Zen creates at runtime from a template, so they never appear literally
 * in the build. Zen's ZenMods.mjs: `theme-${modName}` is the element that
 * carries each mod's preference attributes.
 */
const DYNAMIC_NAMES: RegExp[] = [/^theme-/];

/**
 * `//` is not a CSS comment. The browser treats it as junk and drops everything
 * up to the next `;` — silently discarding the following declaration.
 */
export function findLineComments(css: string): number[] {
  // Blank out block comments and strings (keeping newlines) so we don't flag `url(https://…)`.
  const cleaned = css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => " ".repeat(m.length))
    .replace(/url\([^)]*\)/gi, (m) => " ".repeat(m.length));
  const lines: number[] = [];
  cleaned.split("\n").forEach((line, i) => {
    if (/(^|[;{}])\s*\/\//.test(line)) lines.push(i + 1);
  });
  return lines;
}

function ancestorAtRules(node: Rule): AtRule[] {
  const out: AtRule[] = [];
  let p: Container | undefined = node.parent as Container | undefined;
  while (p && p.type !== "root") {
    if (p.type === "atrule") out.push(p as AtRule);
    p = p.parent as Container | undefined;
  }
  return out;
}

class Checker {
  readonly missing = new Map<string, MissingToken>();
  constructor(private corpus: Corpus) {}

  private record(kind: TokenKind, name: string, line: number, breaking: boolean) {
    const key = `${kind}:${name}`;
    let m = this.missing.get(key);
    if (!m) this.missing.set(key, (m = { kind, name, lines: [], breaking: false }));
    if (!m.lines.includes(line)) m.lines.push(line);
    m.breaking ||= breaking;
  }

  private known(name: string): boolean {
    return this.corpus.tokens.has(name) || DYNAMIC_NAMES.some((re) => re.test(name));
  }

  /**
   * Returns true if this selector can never match the current UI.
   * `soft` = we're inside :not(), where a missing token doesn't kill the selector.
   */
  isDead(sel: Selector, line: number, soft = false): boolean {
    let dead = false;
    for (const node of sel.nodes) {
      if (node.type === "id" || node.type === "class" || node.type === "tag") {
        const kind: TokenKind = node.type === "tag" ? "element" : node.type;
        const name = node.type === "tag" ? node.value.toLowerCase() : node.value;
        if (node.type === "tag" && (name === "*" || /^\d/.test(name))) continue;
        if (!this.known(name)) {
          this.record(kind, name, line, !soft);
          if (!soft) dead = true;
        }
      } else if (node.type === "pseudo" && node.nodes.length > 0) {
        const pseudo = node.value.toLowerCase();
        const args = node.nodes as Selector[];
        if (pseudo === ":not") {
          args.forEach((a) => this.isDead(a, line, true));
        } else if (ALTERNATIVE_PSEUDOS.has(pseudo)) {
          const results = args.map((a) => this.isDead(a, line, soft));
          if (!soft && results.every(Boolean)) dead = true;
        }
        // Other functional pseudos (:nth-child, :host, ::part, :lang…) take
        // non-selector or shadow-scoped arguments; don't judge them.
      }
    }
    return dead;
  }
}

function emptyAnalysis(status: Analysis["status"], error?: string): Analysis {
  return { totalRules: 0, deadRules: [], missing: [], warnings: [], score: status === "error" ? 0 : 100, status, error };
}

export function analyzeCss(css: string, corpus: Corpus, suggester?: Suggester): Analysis {
  const warnings = new Set<string>();
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch (e) {
    // Browsers recover from syntax errors, so analyze what they would keep.
    const err = e as { line?: number; reason?: string; message: string };
    warnings.add(`Line ${err.line ?? "?"}: CSS syntax error (${err.reason ?? err.message}); the browser drops part of this rule`);
    try {
      root = safeParse(css) as Root;
    } catch (e2) {
      return emptyAnalysis("error", `CSS parse error: ${(e2 as Error).message}`);
    }
  }
  for (const line of findLineComments(css)) {
    warnings.add(`Line ${line}: \`//\` is not a CSS comment; the browser discards the next declaration. Use /* … */`);
  }

  const checker = new Checker(corpus);
  const deadRules: DeadRule[] = [];
  const deadSet = new WeakSet<Rule>();
  const parse = selectorParser();
  let totalRules = 0;

  root.walkRules((rule) => {
    const ats = ancestorAtRules(rule);
    if (ats.some((a) => SKIP_AT_RULES.has(a.name.toLowerCase()))) return;
    totalRules++;
    const line = rule.source?.start?.line ?? 0;

    const parent = rule.parent;
    if (parent && parent.type === "rule" && deadSet.has(parent as Rule)) {
      deadSet.add(rule);
      deadRules.push({ selector: rule.selector, line, reason: "parent" });
      return;
    }

    let selectors: Selector[];
    try {
      selectors = parse.astSync(rule.selector).nodes as Selector[];
    } catch {
      warnings.add(`Line ${line}: could not parse selector \`${rule.selector}\``);
      return;
    }
    const results = selectors.map((s) => checker.isDead(s, line));
    const selectorDead = results.length > 0 && results.every(Boolean);

    if (selectorDead) {
      deadSet.add(rule);
      deadRules.push({ selector: rule.selector.replace(/\s+/g, " ").trim(), line, reason: "selector" });
    }
  });

  if (totalRules === 0) return { ...emptyAnalysis("empty"), warnings: [...warnings] };

  const score = Math.round(100 * (1 - deadRules.length / totalRules));
  const status: Analysis["status"] =
    deadRules.length === 0 ? "healthy" : score >= 50 ? "degraded" : "broken";

  return {
    totalRules,
    deadRules,
    missing: [...checker.missing.values()]
      .map((m) => ({ ...m, suggestion: m.breaking ? suggester?.suggest(m.name) : undefined }))
      .sort((a, b) => Number(b.breaking) - Number(a.breaking) || a.name.localeCompare(b.name)),
    warnings: [...warnings],
    score,
    status,
  };
}
