# zen-mod-health

**Finds [Zen Browser](https://zen-browser.app) mods that were broken by browser updates — and suggests the fix.**

Zen mods are CSS that restyles the browser's own interface. When Zen or Firefox renames an element
(`#translation-button` → `#translations-button`), every mod that targets it silently stops working.
Nothing tells the user or the author. This tool checks every mod in the
[Zen theme store](https://github.com/zen-browser/theme-store) against the latest Zen release and reports:

- **Dead rules** — selectors that reference UI that no longer exists, with line numbers
- **Suggested fixes** — the closest name that *does* exist (catches renames and typos)
- **Silent CSS bugs** — e.g. `//` "comments", which make the browser drop the next declaration

```
$ npm run check
Indexing Zen build in C:\Program Files\Zen Browser …
  Zen 1.24.1b: 275,513 names from 5605 files
Checking 77 mods …

🟢 65 healthy  🟡 9 degraded  🔴 1 broken  ⚠️ 0 errors  ⚪ 2 empty
  🔴   0  DoubleClickless  (2/2 rules dead)
  🟡  58  Better Tab Indicators  (5/12 rules dead)
  ...
Report written to reports/ in 3.4s
```

## How it works

1. **Index the browser.** Zen ships its whole UI — markup, scripts and styles — inside `omni.ja`
   zip archives. The tool reads every source file in them and collects each identifier that appears
   anywhere (≈275k names). If a name appears nowhere in the shipped code, no element can have it.
2. **Fetch the store.** Downloads `themes.json` and every mod's `chrome.css` (cached locally).
3. **Analyze selectors** with PostCSS. Each selector is broken into the ids, classes and element
   names it depends on, respecting CSS semantics:
   - `A, B` — a rule is dead only if *every* selector in the list is dead
   - `:not(.x)` — a missing `.x` doesn't kill the selector (it still matches)
   - `:is()/:where()/:has()` — dead only if all alternatives are dead
   - nested rules inside a dead rule are dead too
   - `@keyframes` steps and `@-moz-document` (web-page) rules are skipped
4. **Suggest fixes** using bounded edit distance against the indexed names.
5. **Report** as JSON, Markdown and a self-contained HTML dashboard.

No browser launch is needed, so a full run takes a few seconds and works in CI.

## Validation

The static approach was checked against the **live browser**: Zen was launched headless via
Marionette (Firefox's automation protocol) with several normal and pinned tabs open, and every name
the tool flagged was queried in the real UI. All **28** flagged names matched **0** elements, while
control names (`#tabbrowser-tabs`, `.tab-label`, `#urlbar`) were found.

Two false positives found during development were fixed and are covered by tests:

- `#theme-<ModName>` ids are created at runtime by Zen (`ZenMods.mjs`) for mod preferences.
- `@media (-moz-bool-pref: …)` looked deprecated (Zen's own CSS only uses `-moz-pref()`), but
  injecting both into Zen's privileged stylesheet context showed **both still work**.

## Usage

Requires Node 22+ and a Zen install (or an extracted Linux release tarball).

```sh
npm install
npm run check                                   # uses the default install location
npm run check -- --zen "/path/to/zen"           # or ZEN_DIR=/path/to/zen
npm run check -- --only "context menu"          # check matching mods only
npm run check -- --offline                      # reuse cached store data
npm run check -- --fail-on-broken               # exit 1 if any mod is broken (CI)
npm test
```

Outputs `reports/report.json`, `reports/REPORT.md` and `reports/index.html`.

## CI

`.github/workflows/health.yml` runs daily: it downloads the latest Zen Linux release, checks every
mod, writes the report to the job summary and publishes the dashboard to GitHub Pages.

## Limitations

- Names that Zen builds dynamically in JavaScript (other than `theme-*`) can't be seen statically;
  they'd show up as false positives. None are known in the current store.
- "Exists in the build" is a necessary condition, not a sufficient one: a selector can reference
  real names in a structure that no longer exists (e.g. a changed parent/child relationship).
  Detecting that needs the live DOM — see the roadmap.
- Attribute selectors (`[zen-compact-mode="true"]`) are not checked yet.

## Roadmap

- `--live` mode: run selectors against the real DOM via headless Marionette to catch structural breakage
- Check attribute names and Zen preference names used in `-moz-pref()` queries
- Diff mode: "what did Zen version X → Y break?"
- Open issues on mod repositories automatically when a mod breaks
