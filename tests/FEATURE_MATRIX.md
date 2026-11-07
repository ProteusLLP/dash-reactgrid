# DashReactGrid test matrix

The CI suite tests the **Dash/Python contract**, the **pure JavaScript grid
model**, and the **real Chrome/Dash component**. It complements rather than
replaces the existing reliable sparse edit, 100k-row server-virtual scrolling,
offscreen range editing, and recovery tests.

| Area | Model/contract | Chrome |
| --- | --- | --- |
| Text, number, customnumber, percent, dropdown, checkbox, date, time | Render descriptors, edits, parsing, blank values and serialization | Render all; edit text/customnumber, checkbox and dropdown; paste all types; direct number edit is an expected-failure regression |
| Column formatting and visibility | Type-safe values, styles, formatters, original indices, hidden columns | Rendered classes, hidden values retained after paste |
| Editable rules | Conditional predicates, locked cells, read-only, noneditable columns | Rejected paste into locked/conditional/read-only cells |
| Clipboard | Excel quoted TSV (tabs, Unicode, embedded line breaks/quotes), ReactGrid copy values, hidden column mapping | Ctrl+A/Ctrl+C, native Ctrl+V, synthetic Excel HTML + TSV, grid-to-grid paste |
| Extendable grids | Ghost-row additions, multiple-row paste, defaults, blank rows | Ghost editing and defaults |
| History | Multi-cell step, undo/redo reference stacks | Checkbox undo passes; text and multi-cell clipboard undo are expected-failure regressions |
| Right-click | Row deletion by stable ID | Context menu Delete row |
| Paging | Page boundaries and paste guard | Navigation, last-page ghost, paste boundary |
| Server virtualization | Bounded requests, malformed responses, large row indexes, compact selection and paste | Existing virtual scrolling/offscreen Chrome suites |
| Reliable sparse transactions | Identity/commit acknowledgements and status validation | Existing lost-ACK and reload Chrome suites |
| Export | Bounded chunk streaming, column order, escaped CSV | Existing offscreen CSV Chrome suite |

## Commands

From the repository root, after installing the project and development
dependencies:

    npm ci --legacy-peer-deps
    npm run test:js
    python3 -m unittest tests.test_component_contract -v
    npm run build:js
    python3 -m pip install "dash>=3,<5" "selenium>=4,<5"
    python3 tests/test_feature_matrix_browser.py

The GitHub Actions test workflow runs these together with the existing
Python protocol/transaction tests, all four server virtual/sparse Chrome
suites, the production JS build and the large-grid benchmark. Chrome
is headless on CI and requires an installed Chrome/Chromium browser and a
compatible ChromeDriver (Selenium Manager is used when necessary).

## Test design

* Browser tests use a deterministic Dash application with several independent
  grids and inspect the published data, rowIds, and edits, rather than
  relying solely on cell text.
* Simulated Excel input is supplied through Chrome ClipboardEvent with
  text/plain and optional text/html; native Chrome copy/paste tests exercise
  the actual browser clipboard and keyboard shortcuts.
* Automated tests cannot launch or inspect the desktop Microsoft Excel
  application. They validate its tabular clipboard interchange format.
  Manual interoperability with current Excel versions on Windows
  and macOS remains an additional release acceptance check.
* Stateless Python tests inject deterministic range providers and edit
  handlers; they require no SQLite or server-owned table.
* 100k-row and cross-window tests measure bounded rendering and protocol
  correctness rather than wall-clock performance thresholds, while the
  separate benchmark records large-grid costs.

## Extending the matrix

When adding a cell type, update MATRIX_COLUMNS and MATRIX_DATA in
feature_matrix_browser_app.py, its expected conversion in
featureMatrix.test.mjs, and the round-trip assertions in
test_feature_matrix_browser.py. New right-click commands should have a
direct Chrome assertion for their effect on data or edits. Changes to
the server virtualisation protocol should be tested against the injected
Python provider and the existing real Chrome virtual suites.

Known limitation: the row builder describes customnumber cells as text
rather than the custom numeric template. Chrome has nevertheless verified
a numeric value from direct editing, so the renderer/type inconsistency
remains a code-review finding, not an expected-failure browser test.

Chrome has also reproduced two undo regressions: Ctrl+Z after an ordinary
text edit, and Ctrl+Z after a multi-cell clipboard paste, did not restore the
original values. Both are isolated expected-failure tests, while checkbox
undo is tested as a passing behaviour. These should be fixed in the component
before treating the full editing history as production-ready.

Chrome also reproduces a failure to publish direct edits in a regular
number column. Paste conversion to the same column passes independently.
The direct number edit has an expected-failure test until repaired.
