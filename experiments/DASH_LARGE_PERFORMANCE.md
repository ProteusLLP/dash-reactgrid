# Dash large-grid browser benchmarks

Measurement date: 7 November 2026

Source: real Python Dash fixture and headless Chrome on the same GitHub Actions
Ubuntu runner. The successful complete nine-scenario run is
[42419943330](https://github.com/ProteusLLP/dash-reactgrid/actions/runs/42419943330);
the first 100k/10k run is
[42419325407](https://github.com/ProteusLLP/dash-reactgrid/actions/runs/42419325407).
All cases include numeric NumPy float64 transport where applicable. Each
scenario has 12 columns. Runs are single passes, with separate Dash and
Chrome processes per scenario. These are indicative measurements rather than
repeatability/percentile claims.

## Initial load and resident JS heap

| Rows | Mode | Renderer | Initial Dash layout | Time to usable grid | JS heap after forced GC | Grid DOM nodes |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 10,000 | Unpaged | ReactGrid | 1.41 MB | 2,163 ms | 45.0 MiB | 597 |
| 10,000 | Unpaged | Glide | 1.41 MB | 929 ms | 20.0 MiB | 13 |
| 100,000 | Client paged, 250 rows | ReactGrid | 14.29 MB | 819 ms | 8.16 MiB | 605 |
| 100,000 | Client paged, 250 rows | Glide | 14.29 MB | 822 ms | 7.54 MiB | 271 |
| 100,000 | Stateless server virtual, 120-row windows | ReactGrid | 1.60 KB | 525 ms | 6.26 MiB | 472 |
| 1,000,000 | Stateless server virtual, 120-row windows | ReactGrid | 1.61 KB | 524 ms | 6.26 MiB | 472 |

Repeats in the first run gave 10k unpaged ReactGrid 1,335 ms / 46.2
MiB and Glide 842 ms / 20.0 MiB; 100k paged ReactGrid 821 ms / 8.2 MiB
and Glide 814 ms / 7.5 MiB. The 100k virtual variant loaded in 496 ms.
The spread illustrates the need for more repetitions before ranking small
timing differences.

**Important:** `renderer="glide"` in **server-virtual** mode still falls
back to **ReactGrid**. There is no native Glide server-window adapter yet.
The current Glide compatibility bridge also creates ReactGrid-compatible
cell objects for any loaded page. Initial page load numbers include local
loopback Dash delivery, browser parsing and two animation frames, not
intercontinental network latency, database query time or guarantees of
paint completeness.

The heap column is **JavaScript used heap after forced garbage
collection**, not Chrome process RSS, GPU memory, external typed-array
backing storage, server RAM, or total browser memory.

## Virtual scrolling and edit callback

| Scenario | Large jump, loaded data visible | JS heap after scroll | Edit through Dash |
| --- | ---: | ---: | ---: |
| 100,000 × 12 server virtual | 92.8 ms | 6.70 MiB | 69.1 ms |
| 1,000,000 × 12 server virtual | 93.7 ms | 6.82 MiB | 62.9 ms |

The initial server viewport response was ~8.6 KB; a distant response was
~14.3 KB at 100k rows or ~15.9 KB at 1m rows. Each held only a bounded row
window. The Python provider was deterministic and stateless: it computed
rows from requested indexes rather than querying a real database. Remote
network RTT and actual provider read latency would increase these figures.

## Standard versus sparse edit updates, at 100k × 12 with 250-row paging

| Renderer | Standard edit | Sparse edit |
| --- | ---: | ---: |
| ReactGrid | 438.6 ms | 99.7 ms |
| Glide | 421.8 ms | 92.4 ms |

These are measured from keyboard input through a Dash fixture that outputs
the updated `edits` event. The fixture subscribes to `edits`, **not**
`data`. Therefore the standard-edit experiment measures client-side
processing of a full-data update but **does not measure uploading all
14.3 MB to a Python callback**. If a real application subscribes to
`data` rather than `edits`, the network cost may be much larger.

## Interpretation and recommendation

- For **unpaged** tables, the Glide canvas is materially faster and
  leaner even through the compatibility bridge. Avoid large unpaged
  ReactGrid tables: constructing every cell still grows with row count.
  A full unpaged 100k × 12 case was intentionally excluded from CI due
  to its large allocation and potential memory exhaustion.
- For **client-paged** 100k-row datasets, ReactGrid and Glide both
  loaded in ~0.8s on local CI and consumed ~8 / ~7.5 MiB JS heap after
  GC. Paging avoids building all displayed cells, but the initial
  full-data Dash layout remains ~14.3 MB, and the browser retains the
  packed numeric dataset. The 100k-row case therefore **is not bounded
  in initial transfer or total memory**.
- With **stateless server virtualization**, startup layout and browser
  working set remain almost constant from 100k to one million rows,
  with ~0.5s initial load, ~0.09s distant scroll and ~0.06s single-edit
  callback on local CI. It is the strongest architecture for truly
  large, server-backed datasets. This is measured using ReactGrid today.
- **Sparse edit transmission** is a material performance improvement
  even without server virtualization. Prefer consuming `edits` and
  acknowledging reliable batches; do not subscribe to full `data`
  merely to process single-cell changes.
- Do **not** conclude that the current integrated Glide is faster for
  server-virtualized tables. A direct typed-buffer/viewport Glide adapter
  must be implemented and tested before comparing it.

## Reproduce

```sh
npm install --legacy-peer-deps
npm run build:js
python -m pip install "dash>=3,<5" "selenium>=4,<5" "numpy>=1.23,<3"
python tests/benchmark_dash_large_browser.py
```

The experimental CI runs the full matrix and fails on any failed scenario,
including missing edit acknowledgement. Raw JSON and command output are
uploaded in the `dash-large-performance` Actions artifact.

These tests neither prove eventual consistency under a lossy WAN nor simulate
slow storage. A separate benchmark should add realistic provider latency,
concurrent requests, repeated warm/cold samples and browser process RSS.
