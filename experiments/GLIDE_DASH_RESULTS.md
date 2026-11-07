# Dash/Glide Chrome acceptance report

Tested: 7 November 2026
Branch: `experiment/glide-dash-feature-parity`
Successful experimental workflow: [run 42418478130](https://github.com/ProteusLLP/dash-reactgrid/actions/runs/42418478130)
Draft PR: [#66](https://github.com/ProteusLLP/dash-reactgrid/pull/66)

## Verified results

| Suite | Result | Scope |
| --- | --- | --- |
| Glide adapter + existing JS unit tests | Pass | Pure model, cell type translation, locking, date/time values and baseline model tests |
| Webpack production-mode compilation | Pass | Experimental Dash browser bundle built in CI |
| Python contract and NumPy tests | Pass | Existing Dash/Python interfaces |
| Focused Glide regressions | **4/4 pass** | Text typing, time input, undo/redo, NumPy editing |
| Established Chrome/ReactGrid feature matrix | **29/29 pass** | Original DOM-based test suite, production-default renderer |
| Chrome/Dash Glide bridge feature matrix | **17/17 pass** | Native pointer/keyboard/clipboard input through real Dash callbacks |

The 17 Glide tests cover: canvas mounting, Dash selected-cell state,
text/number/percentage/checkbox/dropdown/date/time edits, locked and
read-only cells, Excel TSV paste and Ctrl+A copy, undo/redo, keyboard arrow
navigation, pagination and NumPy-backed editing.

The Glide suite uses coordinate-based pointer operations and real browser
key events because canvas-backed Glide does not expose ReactGrid's
`.rg-cell` DOM elements. The test helper verifies selection focus before
typing; the source-only clipboard fixture has no state callback and is
tested by its actual clipboard value.

## What this does and does not establish

The opt-in `renderer="glide"` works through the Dash component API for
the tested normal and paged grid features. It **does not yet establish**
complete feature parity, a performance improvement for the integrated Dash
component, or that Glide can replace the existing server-virtualised
renderer. The bridge still builds ReactGrid-shaped cells before rendering
Glide and therefore does not deliver Glide's ideal direct typed-array
architecture.

Features not covered by the 17-case Glide acceptance suite include:

- True server-backed Glide viewport fetching, cross-window selection, export,
  reliable sparse ACK, large cross-window paste, and unloaded undo/redo.
  These remain implemented using ReactGrid.
- Excel fill-down, Shift+Enter multi-cell broadcast, context-menu deletion,
  native dropdown editor UI, ghost-row extension, sticky rows and columns,
  column resizing and tooltips, extensive clipboard edge cases and all
  combinations of selection/editing/locking.
- Repeated benchmark runs measuring Dash callback/edit latency and memory
  under production-sized data.

## Release blockers

The normal `JavaScript tests and build` workflow **does not pass** on the
experimental PR because `package-lock.json` and the checked-in browser
bundle have not been regenerated and committed. In particular,
`npm ci` rejects the new Glide and peer dependencies and the changed
React 18 development dependency. The experimental workflow intentionally
uses `npm install --legacy-peer-deps` and builds its own temporary
assets, and passed under that contract.

Before merge: regenerate and review lockfile, Python component metadata,
minified JS and sourcemap (including async chunks); restore the normal
distribution-consistency CI; add the remaining Glide parity tests;
then benchmark a direct typed-array/viewport adapter with the stateless
server provider. The PR is deliberately a draft, and ReactGrid must remain
the default.

No cross-user editing functionality was introduced.
