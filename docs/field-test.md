# Field test: 10 real Zen mod repositories

**Date:** 2026-11-10 · **Zen:** 1.24.1b (Firefox 159.0.1) · **Tool:** zen-mod-health 1.0.0

## Method

1. Picked every mod the store scan flagged that links to a public source repo (7), plus 3 healthy
   mods as a control group.
2. Shallow-cloned each repo and ran the packaged CLI (`npx zen-mod-health <file>`) on the mod's
   CSS **at the repo's current HEAD**.
3. Compared the repo's CSS with the copy shipped in the
   [theme store](https://github.com/zen-browser/theme-store), and compared both results.
4. Confirmed every new finding in the **live browser**: Zen launched headless via Marionette,
   each name queried with `document.querySelectorAll` in `browser.xhtml`.

## Results

| Mod | Repo last commit | Store copy = repo? | Store version | Repo HEAD | What was found |
|---|---|---|---|---|---|
| Better Tab Indicators | 2024-10-11 | yes | 🟡 58 (5/12 dead) | 🟡 58 (5/12) | 5 rules depend on `#uc-tabs`, which does not exist in Zen |
| Cleaned URL bar | 2025-04-07 | no | 🟡 78 (2/9) | 🟡 82 (2/11) | `.urlbarView-body-inner` and `#urlbar-anon-search-settings` are gone. **Exposed a bug in this tool** (see below) |
| Improved Collapsed Tabs | 2025-10-14 | no | 🟡 94 (1/16) | 🟡 95 (1/20) | `.tab-secondary-label` is gone. Tabs now carry `.zen-tab-sublabel`, a likely replacement |
| Zen Context Menu | 2025-08-12 | no | 🟡 95 (7/155) | 🟡 94 (8/141) | 17 stale ids (Pocket, web panels, old workspace items). **`menupopu` typo is fixed in the repo but the store still ships it** |
| Tab Numbers | 2026-04-12 | no | 🟡 96 (1/26) | 🟡 97 (1/29) | `#vertical-pinned-tabs-container` is gone |
| Sidebar Expand on Hover | 2026-06-09 | no | 🟡 99 (1/195) | 🟡 99 (1/202) | `.tab-reset-pin-label` is gone; `//` "comments" grew from 5 to 9 |
| SuperPins | 2026-05-19 | no | 🟡 99 (1/136) | 🟡 99 (2/148) | **New regression in the repo:** `#Zen-tabs-wrapper` (capital Z), with the suggestion `#zen-tabs-wrapper` |
| Better Find Bar | 2026-09-09 | no | 🟢 100 | 🟢 100 | Control: no findings |
| Ghost Tabs | 2026-10-01 | no | 🟢 100 | 🟢 100 | Control: no findings |
| Container Halo | 2025-10-20 | yes | 🟢 100 | 🟢 100 | Control: no findings |

Live-browser confirmation of the new findings: `#Zen-tabs-wrapper` → 0 elements,
`#zen-tabs-wrapper` → 1. Every other flagged name in this table → 0 elements (verified earlier
for the full store scan).

## What we learned

1. **The store drifts from the source.** 8 of 10 store copies differ from their own repos. A
   fix can land upstream and never reach users. Zen Context Menu's `menupopu` typo is the
   concrete example.
2. **Regressions get introduced, not just inherited.** SuperPins' latest code added a
   wrong-case id that the store copy doesn't have. A check on each pull request (the GitHub
   Action) would have caught it before it merged.
3. **No false positives in the control group.** All 3 healthy mods stayed at 100 on both
   versions.
4. **The field test found a bug in the tool itself.** Cleaned URL bar wraps its whole stylesheet
   in `@-moz-document url-prefix("chrome:")`. The tool assumed every `@-moz-document` block
   targets web pages, skipped all of its rules and reported the mod as "empty". Fixed:
   `@-moz-document` blocks are now checked when they target `chrome:` URLs, and a regression
   test covers this. The fix also corrected the store scan: 2 mods previously reported as
   "empty" are in fact healthy.
5. **Rounding hid a problem.** Sidebar Expand on Hover's repo version scored "degraded 100"
   (1 of 202 rules dead rounds to 100). Fixed: a mod with any dead rule now scores at most 99.

## Reproduce

```sh
git clone --depth 1 https://github.com/CosmoCreeper/Zen-Themes
npx zen-mod-health Zen-Themes/SuperPins        # once published to npm
node dist/cli.js Zen-Themes/SuperPins          # from a local build of this repo
```
