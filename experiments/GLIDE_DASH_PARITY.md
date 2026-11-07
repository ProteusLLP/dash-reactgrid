# Glide Dash feature-parity trial

The Glide renderer is opt-in (`renderer="glide"`), leaves ReactGrid as default,
and currently supports only ordinary and paged tables. When
`virtualRowCount` is provided, the existing ReactGrid server virtualisation
remains in use, regardless of `renderer`. The trial does not change the
existing stateless provider or sparse edit contract.

The bridge translates the existing ReactGrid row/cell representation and edit
callbacks to Glide's DataEditor API, so this is a **compatibility test**, not
yet a performance-optimised implementation. ReactGrid rows are still
constructed for all loaded pages; avoiding that step will require a direct
typed-array Glide data-provider.

## Running the matrix

```sh
npm install --legacy-peer-deps
npm run test:js
npm run build:js
python -m pip install "dash>=3,<5" "selenium>=4,<5" "numpy>=1.23,<3"
python tests/test_feature_matrix_browser.py
python tests/test_glide_dash_browser.py
```

The original browser suite depends on `.rg-cell` DOM selectors which do not
exist in a canvas grid. The Glide suite instead sends real Chrome mouse and
keyboard events and asserts the Dash callback state. Both suites exercise
the same Python fixture; `GRID_RENDERER=glide` selects the trial without
changing tests of the production default.

**Important:** The trial source is intentionally isolated in a draft PR.
The checked-in distribution bundle and generated component metadata must
be regenerated before merging. The experimental CI builds an ephemeral
bundle to run Dash/Chrome tests but does not commit any compiled assets.
The normal distribution consistency check is expected to fail until the
build is committed.

## Feature gate

| Category | State |
|---|---|
| Direct text/number/percentage typing | Browser probes included |
| Checkbox, date, time and dropdown typed input | Browser probes included |
| Locked/read-only cells | Browser probes included |
| Normal-grid clipboard and undo/redo | Browser probes included |
| Pagination | Browser probe included |
| NumPy numeric rows | Browser probe included |
| Server-side continuous virtualization | Existing ReactGrid fallback only |
| Large selection, reliable sparse edits, cross-window undo | Existing ReactGrid fallback only |
| Full Excel native dropdown UI, context menu, fill-down, Shift+Enter | Not yet parity-certified |
| Performance improvement | Not measured with this compatibility bridge |

Do not merge or claim feature parity until the real Chrome results, full
feature matrix and server-backed protocol tests all pass on the Glide
implementation. The existing default implementation must remain stable.
