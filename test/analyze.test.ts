import { describe, expect, it } from "vitest";
import { analyzeCss, findLineComments } from "../src/analyze.js";
import { corpusFromText } from "../src/corpus.js";
import { Suggester, editDistance } from "../src/suggest.js";

// A tiny fake "Zen build": these names exist, anything else doesn't.
const corpus = corpusFromText(`
  <hbox id="tabbrowser-tabs" class="tab-label tab-content"/>
  <toolbarbutton id="translations-button"/> <menupopup id="context_selectAllTabs"/>
  <html:div id="urlbar"/>
`);

describe("analyzeCss", () => {
  it("marks a mod healthy when every selector references existing UI", () => {
    const a = analyzeCss(`#tabbrowser-tabs .tab-label { color: red } #urlbar { margin: 0 }`, corpus);
    expect(a.status).toBe("healthy");
    expect(a.score).toBe(100);
    expect(a.totalRules).toBe(2);
  });

  it("flags a rule whose id was removed, with its line number", () => {
    const a = analyzeCss(`#urlbar {}\n#zen-browser-tabs-wrapper { gap: 0 }`, corpus);
    expect(a.deadRules).toEqual([{ selector: "#zen-browser-tabs-wrapper", line: 2, reason: "selector" }]);
    expect(a.missing[0]).toMatchObject({ kind: "id", name: "zen-browser-tabs-wrapper", lines: [2], breaking: true });
    expect(a.status).toBe("degraded");
  });

  it("keeps a rule alive if any selector in the list still matches", () => {
    const a = analyzeCss(`#gone, #urlbar { color: red }`, corpus);
    expect(a.deadRules).toHaveLength(0);
    expect(a.missing[0].name).toBe("gone"); // still reported as a stale reference
  });

  it("does not kill a selector over a missing name inside :not()", () => {
    const a = analyzeCss(`#urlbar:not(.gone) {}`, corpus);
    expect(a.deadRules).toHaveLength(0);
    expect(a.missing[0]).toMatchObject({ name: "gone", breaking: false });
  });

  it("treats :is()/:has() as alternatives — dead only if all are gone", () => {
    expect(analyzeCss(`:is(#gone, #urlbar) {}`, corpus).deadRules).toHaveLength(0);
    expect(analyzeCss(`:is(#gone, #also-gone) {}`, corpus).deadRules).toHaveLength(1);
    expect(analyzeCss(`#urlbar:has(.gone) {}`, corpus).deadRules).toHaveLength(1);
  });

  it("propagates death to nested rules", () => {
    const a = analyzeCss(`#gone { & .tab-label { color: red } }`, corpus);
    expect(a.deadRules.map((d) => d.reason)).toEqual(["selector", "parent"]);
    expect(a.status).toBe("broken");
  });

  it("accepts #theme-* ids, which Zen creates at runtime for mod preferences", () => {
    const a = analyzeCss(`#theme-My-Mod[my-option="x"] #urlbar {}`, corpus);
    expect(a.status).toBe("healthy");
  });

  it("does not treat -moz-bool-pref as broken (still supported in Zen's privileged sheets)", () => {
    const a = analyzeCss(`@media (-moz-bool-pref: "my.pref") { #urlbar { color: red } }`, corpus);
    expect(a.status).toBe("healthy");
    expect(a.warnings).toHaveLength(0);
  });

  it("ignores @keyframes steps and @-moz-document (web content) rules", () => {
    const a = analyzeCss(`@keyframes x { from {} 50% {} } @-moz-document domain(x.com) { .page-only {} } #urlbar {}`, corpus);
    expect(a.totalRules).toBe(1);
    expect(a.status).toBe("healthy");
  });

  it("recovers from syntax errors like the browser does, and warns", () => {
    const a = analyzeCss(`#urlbar { color: red; // oops it broke\n margin: 0; }`, corpus);
    expect(a.status).not.toBe("error");
    expect(a.warnings.some((w) => w.includes("`//` is not a CSS comment"))).toBe(true);
  });

  it("reports empty for files with no chrome rules", () => {
    expect(analyzeCss(`/* nothing */`, corpus).status).toBe("empty");
  });
});

describe("findLineComments", () => {
  it("finds // comments but not URLs or text inside block comments/strings", () => {
    const css = [
      `a { b: c; // bad`,
      `// also bad`,
      `x { background: url(https://example.com/a.png); }`,
      `/* see https://example.com */`,
      `y { content: "//not a comment"; }`,
    ].join("\n");
    expect(findLineComments(css)).toEqual([1, 2]);
  });
});

describe("Suggester", () => {
  const s = new Suggester(corpus.tokens);
  it("suggests renamed or misspelled names", () => {
    expect(s.suggest("translation-button")).toBe("translations-button");
    expect(s.suggest("context_selectedAllTabs")).toBe("context_selectAllTabs");
    expect(s.suggest("menupopu")).toBe("menupopup");
  });
  it("returns nothing when no name is close", () => {
    expect(s.suggest("completely-unrelated-thing")).toBeUndefined();
  });
  it("computes edit distance with an early cut-off", () => {
    expect(editDistance("kitten", "sitting", 5)).toBe(3);
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3);
  });
});
