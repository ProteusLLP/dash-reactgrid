# DashReactGrid test matrix

The CI suite tests the **Dash/Python contract**, the **pure JavaScript grid
model**, and the **real Chrome/Dash component**. It complements rather than
replaces the existing reliable sparse edit, 100k-row server-virtual scrolling,
offscreen range editing, and recovery tests.

| Area | Model/contract | Chrome |
| --- | --- | --- |
| Text, number, customnumber, percent, dropdown, checkbox, date, time | Render descriptors, edits, parsing, blank values and serialization | Render and edit all types, including direct typing and keyboard navigation in normal and virtual modes, dropdown choices and checkbox Space; paste all types |
| Column formatting and visibility | Type-safe values, styles, formatters, original indices, hidden columns | Rendered classes, hidden values retained after paste |
| Editable rules | Conditional predicates, locked cells, read-only, noneditable columns | Rejected keyboard typing and paste into locked/conditional/read-only cells |
| Clipboard | Excel quoted TSV (tabs, Unicode, embedded line breaks/quotes), ReactGrid copy values, hidden column mapping | Ctrl+A/Ctrl+C, native Ctrl+V, synthetic Excel HTML + TSV, grid-to-grid paste |
| Extendable grids | Ghost-row additions, multiple-row paste, defaults, blank rows | Direct keyboard entry on the ghost row, defaults |
| History | Multi-cell step, undo/redo reference stacks | Text and checkbox undo/redo; multi-cell clipboard undo/redo |
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

## Spreadsheet-style keyboard editing

The Chrome suite tests **select once, type immediately, navigate, and commit**
without double-clicking. It checks the edited source data and the next
focused row/column in Dash, not just what the cell renders:

* Text and conditional text columns: typing replaces the previous value, and
  ArrowRight commits it and moves the focus to the next column.
* Number and customnumber columns: direct entry preserves signed and decimal
  values. Percentage columns accept a value such as `37` as 37%.
* Date and time columns: typing begins a whole-cell text entry rather than
  Chrome's fragmented native date/time input. Dates accept ISO
  `YYYY-MM-DD` or the browser locale's numeric date order; times accept
  24-hour `HH:mm`. Invalid dates and times are rejected. Direct time edits
  preserve the date component of the existing timestamp.
* Dropdown columns: typing selects a matching option by keyboard and Enter
  commits it. Checkbox columns respond to Space and remain navigable.
* Tab and directional arrows are checked in chained edits across columns
  and rows: the previous value is committed, focus advances, and the next
  typed value edits the newly focused cell. Enter is additionally tested
  for committing numeric edits.
* Editing remains blocked in locked, conditional, noneditable and read-only
  cells. Direct typing in the extension row creates a row and applies the
  declared defaults.

Cells opened through the pointer or Enter retain their native in-input caret
behaviour; direct typing from a selected cell uses spreadsheet-style
navigation. As a known upstream ReactGrid quirk, Enter following a Tab
selection can move focus differently from Excel. The browser suite currently
asserts Enter commits, while ArrowDown is used to verify reliable downwards
movement after editing.

Desktop Microsoft Excel itself is not driven by Chrome CI. Native Chrome
clipboard operations and Excel-compatible TSV/HTML interchange are covered.

## Date-only values and international locales

Date columns publish **calendar date strings** in `YYYY-MM-DD` format in
both the `data` and `edits` payloads. They do not publish the UTC
representation of local midnight, which can have a different calendar day.
When displayed again, these strings are parsed as local calendar dates;
time columns continue to preserve full timestamps.

Keyboard entry accepts ISO `YYYY-MM-DD` regardless of browser locale, and
numeric dates in the order reported by `Intl.DateTimeFormat.formatToParts`.
This includes year-first dates such as `2026/11/14` in `ja-JP` as well
as the day-first and month-first formats. Invalid dates are rejected.

Chrome tests exercise both Pacific/Auckland and America/Los_Angeles, checking
that the published date and rendered day remain the same. A Japanese-locale
browser test covers year-first keyboard entry. A stateless server-virtualised
fixture checks that text, date and time editors behave consistently in
continuous scrolling mode, including the sparse edit payload. Each grid owns
its own editor instances, preventing typing state from leaking between grids.

## Resolved regression cases

The regression suite now uses ordinary passing tests for all three previously
identified failures:

* **Number editing:** Ctrl/Cmd+A must select the input's existing value, so
  entering a replacement number does not append to the original text.
  Number and percent inputs preserve native editor clipboard and undo keys.
* **Text editing undo/redo:** the browser test keeps focus on the grid after
  committing a text edit. Ctrl+Z/Y then exercise grid history, rather than
  invoking a newly opened text editor's own undo buffer.
* **Multi-cell paste undo/redo:** the test focuses a header (which cannot
  enter edit mode) before issuing keyboard undo/redo, and verifies restoration
  of the original two-row, two-column data.

The `customnumber` column also uses the shared numeric cell template rather
than falling back to the plain text cell. The production browser assets are
rebuilt and checked for reproducibility in CI.

The distinction between **grid history shortcuts** and **native editor
shortcuts** is important: an active input should retain its own text-selection
and undo behaviour until editing has been committed and focus has returned to
the grid.

## Spreadsheet navigation and range editing

- Ctrl+Arrow jumps to data/column boundaries; Ctrl+Shift+Arrow extends a
  rectangular selection in ordinary, paged and server-virtualized views.
- Ctrl+D copies the first selected row down, or copies from the preceding
  row when only one cell is selected. Locked cells and conditional edit rules
  remain enforced, and normal-mode undo treats it as one edit.
- Shift+Enter in a multi-cell selection applies the edited cell value across
  eligible destinations; single-cell Shift+Enter retains upward navigation.
- JavaScript edge/range tests cover reversed selections, cross-page index
  conversion, TSV clipboard, type conversion, limits and protected cells.
