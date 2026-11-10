import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCss } from "../src/analyze.js";
import { badgeSvg, modBadge, storeBadge } from "../src/badge.js";
import { corpusFromText } from "../src/corpus.js";
import { annotation, findings, readLocalMod } from "../src/local.js";
import { Suggester } from "../src/suggest.js";

const corpus = corpusFromText(`<toolbarbutton id="translations-button"/> <menupopup/> <hbox id="urlbar" class="tab-label"/>`);
const suggester = new Suggester(corpus.tokens);
const fixtures = join(import.meta.dirname, "fixtures");

describe("readLocalMod", () => {
  it("reads a mod folder and takes the name from theme.json", () => {
    const mod = readLocalMod(join(fixtures, "broken-mod"));
    expect(mod.name).toBe("Fixture: broken mod");
    expect(mod.file).toMatch(/chrome\.css$/);
  });
  it("also finds theme.json next to a CSS file given directly", () => {
    expect(readLocalMod(join(fixtures, "healthy-mod", "chrome.css")).name).toBe("Fixture: healthy mod");
  });
  it("errors clearly on a missing path", () => {
    expect(() => readLocalMod("does/not/exist.css")).toThrow(/No such file/);
  });
});

describe("findings", () => {
  it("turns an analysis into sorted, line-level errors and warnings with fixes", () => {
    const a = analyzeCss(readLocalMod(join(fixtures, "broken-mod")).css, corpus, suggester);
    const f = findings(a);
    expect(f.map((x) => [x.level, x.line])).toEqual([
      ["error", 3],
      ["warning", 4],
      ["warning", 4],
      ["error", 6],
    ]);
    expect(f[0].message).toContain("Did you mean `#translations-button`?");
    expect(f[3].message).toContain("Did you mean `menupopup`?");
  });
});

describe("annotation", () => {
  it("formats a GitHub Actions workflow command and escapes newlines", () => {
    const line = annotation({ level: "error", line: 7, message: "bad\nthing 100%" }, join(process.cwd(), "src", "chrome.css"));
    expect(line).toBe("::error file=src/chrome.css,line=7,title=zen-mod-health::bad%0Athing 100%25");
  });
});

describe("badges", () => {
  it("renders a valid SVG with escaped text", () => {
    const svg = badgeSvg("a<b", "x&y", "#000");
    expect(svg).toMatch(/^<svg [^>]*width="\d+"/);
    expect(svg).toContain("a&lt;b");
    expect(svg).toContain("x&amp;y");
  });
  it("colors by status", () => {
    const healthy = analyzeCss("#urlbar {}", corpus);
    const broken = analyzeCss("#gone {}", corpus);
    expect(modBadge(healthy, "1.0")).toContain("#2ea043");
    expect(modBadge(healthy, "1.0")).toContain("healthy · Zen 1.0");
    expect(modBadge(broken, "1.0")).toContain("#cf222e");
    expect(storeBadge(65, 75)).toContain("65/75");
  });
});
