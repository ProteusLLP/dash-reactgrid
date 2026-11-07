# Glide vs RevoGrid vs ReactGrid: experimental renderer bakeoff

This is an isolated, **non-production** comparative prototype. It does not
change the public Dash component, Python helpers, npm dependencies or assets.
It evaluates native React grid engines, not production-grade Dash adapters.

## Run

```bash
cd experiments/renderer-bakeoff
npm install --no-audit --no-fund
npx playwright install chromium
npm run dev
# open http://127.0.0.1:5173/?renderer=glide&rows=100000&cols=12&mode=numeric
npm run verify
```

Change `renderer` to `reactgrid` or `revogrid`. Use `mode=mixed` to try
text, number, percent, checkbox, dropdown, date, time and locked columns.
The benchmark is limited to 4m numeric cells (32 MB) to keep CI bounded.

## Matching conditions and unavoidable differences

All three renderers share `Fixture` with deterministic values, identical
column definitions and a sparse edit stream of
`{kind:"cell",rowId,columnId,value}`. The synthetic numeric fixture uses a
single `Float64Array`, and editable values are held in a sparse overlay.
No edit requires copying the numeric matrix.

* **Glide** uses `getCellContent` to read cells on demand and the native
  `onCellsEdited`, selection, clipboard and fill-handle callbacks. It does
  not construct a whole row array.
* **RevoGrid** receives one complete array of row objects via `source`.
  The cost of materialising that data is reported separately; native
  virtualisation controls DOM size, not construction of the source array.
* **ReactGrid control** receives at most 160 rows. This approximates the
  current project's bounded-cell-matrix optimisation but is **not** the
  complete `ServerVirtualGrid` or its stateless provider interface.

There is no artificial assertion that all three are architecturally
equivalent. The benchmarks expose these costs, rather than reporting
performance improvements based on incomparable definitions of startup.

## What is tested

1. Node tests for the typed array, sparse changes, coercions, stable row IDs,
   field types, locked cells and bounded allocations.
2. Chromium tests that each renderer mounts 100k rows, supports jumping to
   the middle of the dataset, and emits browser errors if it fails.
3. Observational Chrome probes using **real keyboard typing** and the
   system clipboard. The result records whether typing in the first
   focused text cell and Ctrl+C work, rather than silently accepting any
   renderer as equivalent.
4. Startup, fixture creation, RevoGrid source generation, heap, DOM node
   counts and approximate scroll/jump dispatch. JSON/Markdown reports and
   screenshots are retained as GitHub Actions artifacts.

The existing project CI (JavaScript, Python and Chrome feature matrix) also
runs for pull requests. It is not replaced by these observational tests.

## Not implemented and required before any renderer migration

* A real Dash renderer adapter and Python component integration.
* Complete custom dropdown, date, time and percentage editors.
* Excel-equivalent focus, Enter/Tab/Shift+Enter, multi-cell paste/fill,
  undo/redo, context menus, read-only rules and extendable rows.
* Stateless Dash window fetches, global selection, streaming exports,
  optimistic edits and reliable edit acknowledgment/rollback.
* Head-to-head production Dash workloads, multi-run statistics and
  actual end-to-end edit latency through Dash callbacks.

The current package remains the reference implementation. There should
be no renderer replacement decision until the existing feature matrix
passes against a prototype wired through Dash.

## Reference APIs

Glide Data Grid: https://docs.grid.glideapps.com/api/dataeditor

RevoGrid React: https://rv-grid.com/guide/react/

Current grid: https://github.com/ProteusLLP/dash-reactgrid
