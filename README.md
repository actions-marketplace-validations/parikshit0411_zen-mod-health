# zen-mod-health

[![CI](https://github.com/parikshit0411/zen-mod-health/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/parikshit0411/zen-mod-health/actions/workflows/ci.yml)
[![Store mods healthy](https://parikshit0411.github.io/zen-mod-health/badge.svg)](https://parikshit0411.github.io/zen-mod-health/)

**[📊 Live dashboard](https://parikshit0411.github.io/zen-mod-health/)**: every mod in the Zen theme store, checked daily against the latest Zen release.

**Finds [Zen Browser](https://zen-browser.app) mods broken by browser updates, and suggests the fix.**

Zen mods are CSS that restyles the browser's own interface. When Zen or Firefox renames an element
(`#translation-button` → `#translations-button`), every mod that targets it silently stops working.
Nothing tells the user or the author. This tool checks mods against a real Zen release and reports:

- **Dead rules:** selectors that reference UI that no longer exists, with line numbers
- **Suggested fixes:** the closest name that *does* exist (catches renames and typos)
- **Silent CSS bugs:** e.g. `//` "comments", which make the browser drop the next declaration

It runs three ways: as a **CLI** for mod authors, as a **GitHub Action** on every pull request,
and as a **daily scan of the whole theme store** with a public dashboard and badges.

## Check your mod

```sh
npx zen-mod-health chrome.css        # or a mod folder containing chrome.css
```

```
Zen 1.24.1b: 275,513 UI names indexed

🟡 My Mod — degraded, 50/100 (2/4 rules dead)
  chrome.css:2  error    `#translation-button` does not exist in this Zen version. Did you mean `#translations-button`?
  chrome.css:3  warning  `//` is not a CSS comment; the browser discards the next declaration. Use /* … */
  chrome.css:5  error    `menupopu` does not exist in this Zen version. Did you mean `menupopup`?
```

If Zen is installed it is used automatically; otherwise the latest Linux release is downloaded once
(~110 MB) and cached. Check against a specific release with `--zen-version 1.24.1b`.

| Option | |
|---|---|
| `--zen <dir>` | Zen install directory containing `omni.ja` (or set `ZEN_DIR`) |
| `--zen-version <tag>` | Download and check against this release (`latest` by default when nothing is installed) |
| `--fail-on <level>` | Exit 1 at `none`, `broken` or `degraded` (default for your own files: `degraded`) |
| `--badge <file.svg>` | Write a health badge |
| `--json` | Machine-readable output |
| `--store` | Check every mod in the theme store instead (`--out`, `--only`, `--offline`) |

Exit codes: `0` ok · `1` problems at or above `--fail-on` · `2` tool error.

## GitHub Action

Add this to your mod's repository as `.github/workflows/zen-mod-health.yml`:

```yaml
name: Zen mod health
on:
  push:
  pull_request:
  schedule:
    - cron: "0 6 * * 1"   # weekly: catches breakage from new Zen releases
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: parikshit0411/zen-mod-health@v1
        with:
          path: chrome.css        # file(s) or folder(s), space-separated
          fail-on: degraded       # none | broken | degraded
```

Problems appear as inline annotations on the pull request diff. The Zen download is cached
between runs.

## Store dashboard and badges

CI scans every mod in the [Zen theme store](https://github.com/zen-browser/theme-store) daily
against the latest release and publishes a dashboard to GitHub Pages: status filters, search,
per-mod details with line numbers and fixes, and a link to each mod.

Every mod gets a badge at `badges/<mod-id>.svg`. The dashboard shows the Markdown to paste into a
mod's README:

```md
[![zen mod health](https://parikshit0411.github.io/zen-mod-health/badges/<mod-id>.svg)](https://parikshit0411.github.io/zen-mod-health/#<mod-id>)
```

## Results

- **Store scan (Zen 1.24.1b):** 77 mods: 67 healthy, 9 degraded, 1 broken.
- **[Field test on 10 mod repositories](docs/field-test.md):** found a new regression in a mod's
  latest code, a fix that never reached the store, and that 8 of 10 store copies have drifted
  from their source. It also exposed a bug in this tool, now fixed.

## How it works

1. **Index the browser.** Zen ships its UI (markup, scripts, styles) inside `omni.ja` zip
   archives. The tool collects every identifier in them (≈275k names). If a name appears nowhere
   in the shipped code, no element can have it. The index is cached per Zen version.
2. **Analyze selectors** with PostCSS, respecting CSS semantics:
   - `A, B`: a rule is dead only if *every* selector in the list is dead
   - `:not(.x)`: a missing `.x` doesn't kill the selector (it still matches)
   - `:is()/:where()/:has()`: dead only if all alternatives are dead
   - nested rules inside a dead rule are dead too
   - `@keyframes` steps and `@-moz-document` blocks for web pages are skipped; blocks that
     target `chrome:` URLs are checked
3. **Suggest fixes** using bounded, case-sensitive edit distance against the indexed names.
4. **Report** as console output, GitHub annotations, JSON, Markdown, HTML and SVG badges.

No browser launch is needed, so a check takes about 2 seconds once Zen is cached.

## Validation

- **Live browser:** Zen was launched headless via Marionette (Firefox's automation protocol) and
  every name the tool flagged was queried in the real UI. All **28** store findings, and the
  new field-test finding, matched **0** elements; control names were found.
- **False positives fixed and tested:**
  - `#theme-<ModName>` ids are created at runtime by Zen (`ZenMods.mjs`) for mod preferences.
  - `@media (-moz-bool-pref: …)` looked deprecated (Zen's own CSS uses `-moz-pref()`), but
    injecting both into Zen's privileged stylesheet context showed **both still work**.
  - `@-moz-document url-prefix("chrome:")` targets the browser UI, not web pages.
- **CI self-test:** the action runs against a known-healthy and a known-broken fixture mod on
  every push.

## Development

```sh
npm install
npm test               # unit tests
npm run typecheck
npm run check -- <file>          # run from source
npm run store -- --out reports   # scan the whole store
npm run build                    # compile to dist/
```

## Limitations

- Names that Zen builds dynamically in JavaScript (other than `theme-*`) can't be seen statically.
- CI indexes the Linux build, which has ~1.5k fewer names than the Windows build. A
  Windows-only element would be flagged on Linux.
- "Exists in the build" is necessary, not sufficient: a selector can use real names in a
  structure that no longer exists (a changed parent/child relationship). That needs the live DOM.
- Attribute selectors (`[zen-compact-mode="true"]`) are not checked yet.

## Roadmap

- `--live` mode: run selectors against the real DOM via headless Marionette
- Check repos as well as the store copy, and flag store copies that drifted from source
- Diff mode: "what did Zen version X → Y break?"
- Check attribute names and preference names used in `-moz-pref()` queries

## License

[MIT](LICENSE)
