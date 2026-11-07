# Renderer bakeoff: first measured results

## Scope
These numbers were recorded by **GitHub Actions experimental renderer bakeoff run
[42414112371](https://github.com/ProteusLLP/dash-reactgrid/actions/runs/42414112371)**
on Ubuntu 24.04/Chromium. Each workload was run once on shared CI hardware;
the figures are indicative and **not** a statistically reliable speedup claim.
The control wraps the basic ReactGrid engine in a 160-row window, not the
published Dash component. The experiment has no Dash callbacks or server data
provider. "Initial ready" is a double-animation-frame mount signal, **not**
time to fetch all data or certify complete cell painting.

| Renderer | Workload | Initial ready (ms) | JS heap (MiB) | DOM nodes | Source construction (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| ReactGrid (bounded control) | 100k × 12 numeric | 154 | 6.9 | 1,015 | 0 |
| Glide Data Grid | 100k × 12 numeric | 153 | 4.9 | 162 | 0 |
| RevoGrid | 100k × 12 numeric | 245 | 27.5 | 258 | 127.1 |
| ReactGrid (bounded control) | 50k × 8 mixed | 117 | 5.8 | 843 | 0 |
| Glide Data Grid | 50k × 8 mixed | 126 | 4.6 | 162 | 0 |
| RevoGrid | 50k × 8 mixed | 145 | 14.1 | 248 | 62.1 |

All six Playwright tests passed; there were zero uncaught browser errors
in the benchmark after setting the browser locale to a standard BCP-47
`en-US` value. The fixed-locale rerun removed the earlier ReactGrid
number-formatting exception, which had distorted its numeric timings.

## Editing observations
For the 300-row mixed-cell fixture, the test clicked the first visible text
cell, typed `Probe` with real keyboard events, pressed Enter, and attempted
Ctrl+C through the browser clipboard. **Glide and RevoGrid** both persisted
`Probe` in row 0 and copied a matching value. The **minimal ReactGrid
control** persisted `probe` (lowercase) and the clipboard probe returned
no matching value; this is **not evidence of a regression in the actual
Dash wrapper** because our production grid supplies custom editor and
clipboard integration absent from this simple control.

An earlier Glide test lost the initial character after the click; correcting
the click target to the first data row resolved this in the repeat run.
The final observation therefore does **not** reproduce a first-character
loss. None of these checks establishes edit behaviour for all supported
column types or Excel navigation gestures.

## Interpretation
Glide kept the source numeric data in a `Float64Array`, constructed cells
on demand and had the lowest measured numeric JavaScript heap. ReactGrid's
bounded window delivered roughly similar initial-ready time in this
experiment, so we **cannot** claim a large improvement for typical narrow
grids on render speed alone. RevoGrid's conventional `source` prop required
materialising 100,000 objects and 1.2 million values: the measured extra
127 ms and approximately 27.5 MiB JS heap are an architectural concern
unless we can integrate a true viewport data provider.

The jump metric is only dispatch plus two animation frames, not end-to-end
scroll hydration or paint completion; it should not be used as a ranking.

## Recommendation and migration gate
**Glide is the preferred candidate for a second-stage Dash integration**,
due to lazy cell access, smaller heap and successful first-cell keyboard
editing. RevoGrid remains a useful alternative for its native editing
behaviour. **Do not replace the current ReactGrid renderer yet.**

Before any migration, implement a real Dash adapter reusing our stateless
window provider, NumPy transport, sparse reliable ACK and selection/range
operations. Run the existing Chrome feature matrix against that adapter,
particularly: direct typing and committing via arrows/Tab/Enter/Shift+Enter,
clipboard round-tripping with Excel, multiselect paste/fill, dropdown/date/time/
percent editors, locked cells, undo/redo, extendable rows, context menus,
100k+ row scrolling with bounded application/server payloads, and callbacks
under simulated network latency. Collect multiple warm/cold runs and
interactive edit latency distributions in a production Dash app.

Raw measurements and screenshots are attached as GitHub Actions artifacts
for run 42414112371. The experiment intentionally stays isolated and no
published component interface changes.
