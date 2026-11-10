# Dash ReactGrid

## Multi-level column headers

Add `header_path` to a Python `Column` (or `headerPath` to a plain
column dictionary) to render parent groups above the ordinary leaf header.
Parent labels run from outermost to innermost; arbitrary nesting is supported.
Only adjacent columns with an identical ancestor path are visually merged.
Hidden columns are excluded from the visible spans. Data positions, IDs, edits
and clipboard values still refer only to leaf columns.

```python
from dash_reactgrid import Column, DashReactGrid

columns = [
    Column("gbp_1y", "1y", type="number", header_path=["Rates", "GBP"]),
    Column("gbp_5y", "5y", type="number", header_path=["Rates", "GBP"]),
    Column("usd_1y", "1y", type="number", header_path=["Rates", "USD"]),
]
grid = DashReactGrid(columns=columns, data=[[0.04, 0.045, 0.039]],
                     stickyTopRows=1)
```

The grouped header rows also work in the server-backed virtual grid. When
`stickyTopRows` includes the leaf header, its parent bands are kept sticky
as well. ReactGrid's cell spanning is a visual facility with known limitations
around mouse selection and focus on merged cells; use the leaf header or data
cells for normal spreadsheet interactions.

## Create a grid from a DataFrame

`DashReactGrid.from_dataframe` accepts pandas DataFrames, Polars DataFrames,
and simple DataFrame-like objects providing `columns`, `dtypes` and a row
iterator (`itertuples` or `iter_rows`). Neither pandas nor Polars is a
required library dependency. Cell types are inferred (number, checkbox, date,
or text), null values are converted to blanks, and duplicate column labels
receive unique internal IDs. A pandas MultiIndex automatically creates grouped
headers. Numeric homogeneous frames use the existing compact NumPy transport.

```python
import pandas as pd
from dash_reactgrid import DashReactGrid

df = pd.DataFrame({
    ("UK", "1y"): [0.04, 0.041],
    ("UK", "5y"): [0.045, 0.046],
    ("US", "1y"): [0.039, 0.04],
})
grid = DashReactGrid.from_dataframe(
    df, id="rates", rowPageSize=250, stickyTopRows=1,
    column_types={("UK", "1y"): "percent"},
    column_options={("UK", "1y"): {"width": 130, "tooltip": "UK 1 year"}},
)
```

Pass `include_index=True` to expose a pandas index as one or more columns.
`column_types` and `column_options` use original column labels,
including tuples and integer-valued labels. To refer to zero-based column
positions, use `column_types_by_position` and
`column_options_by_position`. Positional overrides take precedence when both
mappings specify a column. All other keyword arguments
pass through to `DashReactGrid`. The constructor materialises mixed-type
frames; for very large datasets use the stateless virtual-grid API instead
of sending a full DataFrame to Dash.

## Python column definitions and header tooltips

Use `Column` to create JSON-compatible column definitions with Python-style
parameter names. `Column` inherits from `dict`, so it works directly in
`DashReactGrid(columns=...)`, in Dash callbacks and alongside plain dictionaries.

```python
from dash_reactgrid import Column, DashReactGrid

columns = [
    Column("name", "Name", tooltip="Customer name", width=180),
    Column("amount", "Amount", type="number", tooltip="Amount in GBP",
           align="right", format_options={"maximumFractionDigits": 2}),
    Column("status", "Status", type="dropdown", values=["Open", "Closed"],
           header_style={"fontWeight": "bold"}, non_editable=False),
]
grid = DashReactGrid(columns=columns, data=[["Alpha", 100.25, "Open"]])
```

The optional `tooltip` key also works in existing column dictionaries, for
example `{"columnId": "name", "title": "Name", "type": "text",
 "tooltip": "Customer name"}`. Hovering over the header label shows the
browser’s native tooltip. Headers with no tooltip remain unchanged. Both
ordinary grids and server-virtualized grids support this field. Other
Python options include `style`, `header_style`, `format_options`, `values`,
`editable_when`, `class_name`, `non_editable`, `align` and `width`. Call
`column.to_dict()` if an ordinary dictionary is needed.

Dash ReactGrid is a Dash component library.

Get started with:
1. Install Dash and its dependencies: https://dash.plotly.com/installation
2. Run `python usage.py`
3. Visit http://localhost:8050 in your web browser

## NumPy data transport

NumPy is an optional dependency. Two-dimensional homogeneous numeric arrays
can be passed directly as `data`. DashReactGrid transfers their bytes as a
base64-encoded, little-endian numeric buffer, and the browser retains this
as a typed array, materializing only the rows needed for rendering.

```python
import numpy as np
from dash_reactgrid import DashReactGrid

values = np.random.default_rng(12).normal(size=(100_000, 8))
columns = [{"columnId": str(i), "title": str(i), "type": "number"}
           for i in range(values.shape[1])]

grid = DashReactGrid(
    id="grid", columns=columns, data=values,
    rowIds=[f"row-{i}" for i in range(len(values))],
    transmitSparseEdits=True, editDatasetId="numeric-v1",
    rowPageSize=250,  # bound ReactGrid rendering; use virtualization for larger datasets
)
```

Supported dtypes are float32/float64, signed and unsigned 8/16/32-bit
integers, booleans, and float16 (promoted to float32). int64/uint64
values are transferred as float64 only within the JavaScript safe
integer range. Out-of-range integers are rejected rather than rounded.
Non-finite floats render as blank cells; Unicode and object arrays
fall back to nested-list JSON, subject to normal Dash serialization rules.
Masked NumPy arrays are rejected because this binary protocol has no mask
bitmap and must not expose hidden backing values. For floating-point masked
arrays, use `array.filled(np.nan)`; otherwise supply nested Python lists
with explicit `None` values.

The data supplied to Python callback inputs remains the encoded dictionary
until decoded with `from dash_reactgrid import decode_numpy_data`. In full
data-publishing mode, a cell edit sends nested lists as before. Use
`transmitSparseEdits=True` for large editable arrays to avoid transmitting
the complete grid after each edit. The existing durable-ACK semantics apply.

Stateless virtualisation also accepts a NumPy viewport from a provider:

```python
from dash_reactgrid.stateless_virtual import window_response

def fetch_rows(start, end):
    return {"rowIds": [str(i) for i in range(start, end)],
            "data": values[start:end]}

# In the virtualRequest callback:
response = window_response(request, dataset_id="numeric-v1",
                           row_count=len(values), columns=columns,
                           fetch_rows=fetch_rows)
```

Use `decode_numpy_data(response["data"])` to recover a read-only
NumPy view of a binary payload. Clipboard and CSV helpers continue to
work with list-backed or NumPy-backed provider windows.

## Client-side windowed rendering (full dataset in browser memory)

For in-memory tables that fit in browser RAM, set `virtualizationMode="client"`
to render a bounded viewport without loading rows from Dash during scrolling.
This uses the existing typed-array NumPy transport for homogeneous numeric
matrices, plus its copy-on-write overrides for edited rows. Mixed-type tables
remain supported using normal JavaScript row arrays. ReactGrid receives only a
visible window and a small overscan buffer, with scroll spacers for the other
rows. There are no paging buttons.

```python
import numpy as np
from dash_reactgrid import DashReactGrid

values = np.random.default_rng(42).normal(size=(100_000, 20))
columns = [{"columnId": str(j), "title": str(j), "type": "number"}
           for j in range(values.shape[1])]

grid = DashReactGrid(
    id="grid", columns=columns, data=values,
    virtualizationMode="client", virtualWindowSize=120,
    virtualRowHeight=25, virtualViewportHeight=420,
    rowIds=[f"r{i}" for i in range(len(values))],
    transmitSparseEdits=True, editDatasetId="numeric-v1",
)
```

Client mode uses the full data for Ctrl+F, Ctrl+End, Ctrl+D, Shift+Enter,
and absolute selections, including rows not currently mounted. Ctrl+A selects
the entire logical dataset and Ctrl+C reads the underlying data rather than
constructing offscreen ReactGrid cells. Browser clipboard output has a 64 MiB
character safety cap, so especially large exports should use a separate
backend export. In sparse-edit mode applications must implement the existing
durable edit acknowledgements, and should provide stable row IDs for
structural editing.

The dataset is transferred **once** on initialisation. It still consumes
browser memory, and decoding the base64 NumPy transport creates temporary
allocations. Use server virtualisation if the dataset is too large to transfer
or retain in the browser. Omit `virtualizationMode` to preserve legacy
behaviour: `virtualRowCount` selects server mode; otherwise the normal
in-memory grid is used. `virtualizationMode="none"` forces the normal
in-memory rendering mode.

## Large tables: continuous server-side virtualization

**Recommended for hundreds of thousands of rows or millions of cells:**
use the server-backed continuous virtual scrolling mode, rather than
transferring a full table or navigating pages. The browser requests small,
absolute row intervals as the user scrolls. ReactGrid is given only those
rows plus two lightweight spacer rows. It therefore has a bounded cell
matrix even though the browser shows a normal scrollbar for the whole
logical dataset.

```python
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid

app = Dash(__name__)
columns = [
    {"columnId": "name", "title": "Name", "type": "text"},
    {"columnId": "value", "title": "Value", "type": "number"},
]
row_count = 100_000

app.layout = html.Div([
    DashReactGrid(
        id="grid",
        columns=columns,
        data=[],                     # NO full dataset in the browser
        virtualRowCount=row_count,
        virtualDatasetId="assets-2026-v1",
        virtualRowHeight=25,        # fixed row height in CSS pixels
        virtualWindowSize=120,      # requested rows per window
        virtualViewportHeight=420,
    ),
])

@app.callback(
    Output("grid", "virtualData"),
    Input("grid", "virtualRequest"),
    prevent_initial_call=True,
)
def load_rows(request):
    start, end = request["start"], request["end"]  # [start, end)
    # Fetch by indexed offset from your authoritative store; never
    # construct or serialize the complete table in this callback.
    row_ids, values = fetch_rows(start, end)  # application-specific
    return {
        "datasetId": request["datasetId"],
        "requestId": request["requestId"],
        "start": start,
        "rowIds": row_ids,          # one stable ID per returned row
        "data": values,             # arrays in columns' original order
    }
```

Set `virtualDatasetId` to a new value when the server-side ordered dataset
changes (sorting, filtering, rebuilding or changing its revision). All
cached windows become invalid. `virtualRowCount` describes the entire
dataset, not just the fetched window. Row indices in requests are zero-based,
with `start` inclusive and `end` exclusive. The response must echo the
dataset ID, request ID and start, and contain exactly `end-start` rows.
Responses for previous requests are discarded. A bounded client cache keeps
up to four windows, and missing requests are retried.

The viewport gives ReactGrid only approximately `virtualWindowSize` rows at
a time; the scrollbar uses spacer geometry to retain the positions of all
other rows. No next/previous page controls are needed. Fixed data-row
height is required for correct scroll positions. The physical scroll height
is capped for very large datasets, while scroll positions are mapped back
to logical row indices.

**Editing:** Server virtual mode uses sparse `edits` batches and
`transmitSparseEdits=True` together with a stable `editDatasetId` and
transactional `editAck`. Loaded cell edits update optimistically; inserting
and deleting rows, pasting and clearing ranges in unloaded windows, and
undo/redo are committed by the server and fetched back on acknowledgement.
The component updates its row count from the committed acknowledgement and
invalidates stale viewport caches. Server virtual mode is read-only unless
reliable sparse transmission is enabled.

**Global selection:** Click and drag or Shift-click to extend a selection,
including after scrolling into another server window. Ctrl+Arrow navigates to
the dataset boundaries and Ctrl+Shift+Arrow extends the selection to them.
Click a column header or use Ctrl+Space to select an entire logical column.
Ctrl+A selects all rows and visible columns, including unloaded rows. The browser
holds only four boundary indices, never an array of every selected row.
`virtualSelection` publishes these indices to Dash. There are no separate
row-number inputs or selection buttons.

For Excel-compatible **Ctrl+A then Ctrl+C** on large server-virtualized
grids, provide `virtualClipboardUrl` pointing to an authenticated same-origin
endpoint that streams headerless TSV. Pressing Ctrl+C starts the browser
clipboard write during the user gesture, and its `ClipboardItem` resolves
the response asynchronously. The browser does not
load grid rows into ReactGrid or send the selection through Dash. There is no
arbitrary row/cell-count cap, but actual clipboard capacity depends on the
browser, operating system and available memory. A separate `virtualExportUrl`
can be used by the hosting application to offer a separate CSV download
if clipboard permissions or capacity prevent copying. The grid itself does not
render an export button or link. Applications must authorise access to the
entire requested range. Chromium-based browsers with Async Clipboard API and
promised ClipboardItem support provide the streaming path; on unsupported
browsers the application can offer CSV export.

When no `virtualClipboardUrl` is configured, small ranges can still be copied
using `virtualRangeRequest`/`virtualRangeData`, with the existing
1,000-row/1 MB preparation limits. The selection is prepared automatically;
press Ctrl+C again if the asynchronous request has not yet completed. Clipboard **pastes** of up to 1,000 rows and
20,000 cells are applied by the server, including cells in unloaded rows.
Insertion and deletion operate at absolute positions, and undo/redo use
transactional inverse receipts rather than loading the whole table. Right-click
inside the grid to insert a row above the selection, append a row, delete
selected rows, or undo/redo. Ctrl+Plus inserts above the selection, Ctrl+Minus
deletes selected rows (with confirmation), and Ctrl+Z/Ctrl+Y undo/redo.
For an empty virtual grid, focus the empty viewport and press Ctrl+Plus.

**Boundaries:** This is a single-editor editing protocol with no collaborative
revision detection. Pending changes normally survive reloads in the same
tab, but may be lost if session storage is cleared or the tab is closed
before acknowledgement. Operations spanning excessive numbers of rows
are rejected with an error rather than silently truncated.

**Legacy alternative: bounded client-side paging.** `rowPageSize=250`
remains available for existing grids that already send the entire dataset
in `data`. It limits ReactGrid's cell matrix but still transfers and owns
the full data in the browser. When `virtualRowCount` is provided, server
virtualization takes precedence over client paging.

The nonvirtualized renderer still shares number/date formatters and dropdown
options across cells, uses copy-on-write edits and can reuse unchanged rows.
For smaller full-data grids, `disableVirtualScrolling=False` reduces DOM
overhead but does not reduce ReactGrid's internal matrix.


### Stateless server-side integration

The grid does **not** create or depend on SQLite, a database connection,
a cache service, or a process-local row store. No full table is kept in the
component. The application already owns the authoritative data; it supplies
four functions to Dash:

- **Read a window:** `read_rows(start, end)` returns stable row IDs and values.
- **Commit a batch:** `commit_batch(batch)` applies commands to the
  application's data source and returns an acknowledgement.
- **Read a clipboard range:** `read_rows` can also supply the selected
  values in chunks.
- **Export:** a streaming endpoint obtains rows from the same provider.

`dash_reactgrid.stateless_virtual` contains pure, dependency-free
request handlers with no global or persistent state. The host application
injects its own data-access functions. For example:

```python
from dash import Dash, Input, Output, callback
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import (
    window_response, clipboard_response, find_response, edit_ack,
)

# These functions already belong to your application. They may access
# a DataFrame, a file, a database, an existing service, or another model.
# read_rows(start, end) -> {"rowIds": [...], "data": [[...], ...]}
# commit_batch(batch) -> {"status": "ok", "rowCount": ..., "revision": ...}
# count_rows() -> int

DATASET = "assets-v1"
columns = [
    {"columnId": "name", "title": "Name", "type": "text"},
    {"columnId": "value", "title": "Value", "type": "number"},
]
app = Dash(__name__)
app.layout = DashReactGrid(
    id="grid",
    columns=columns,
    data=[],
    rowIds=[],
    virtualRowCount=count_rows(),
    virtualDatasetId=DATASET,
    virtualWindowSize=120,
    virtualViewportHeight=420,
    transmitSparseEdits=True,
    editDatasetId=DATASET,
)

@callback(Output("grid", "virtualData"), Input("grid", "virtualRequest"),
          prevent_initial_call=True)
def fetch_window(request):
    return window_response(
        request, dataset_id=DATASET, row_count=count_rows(),
        columns=columns, fetch_rows=read_rows,
    )

@callback(Output("grid", "virtualFindData"),
          Input("grid", "virtualFindRequest"),
          prevent_initial_call=True)
def find_anywhere(request):
    return find_response(
        request, dataset_id=DATASET, row_count=count_rows(),
        columns=columns, fetch_rows=read_rows, chunk_size=250,
    )

@callback(Output("grid", "editAck"), Input("grid", "edits"),
          prevent_initial_call=True)
def save_commands(batch):
    return edit_ack(batch, dataset_id=DATASET,
                    apply_batch=commit_batch)

@callback(Output("grid", "virtualRangeData"),
          Input("grid", "virtualRangeRequest"),
          prevent_initial_call=True)
def prepare_copy(request):
    return clipboard_response(
        request, dataset_id=DATASET, row_count=count_rows(),
        columns=columns, fetch_rows=read_rows,
    )
```

The row provider and commit function in this example are application-supplied,
not provided by the grid. A production application must authorise access to
the requested dataset and enforce edit rules on the data source. The helper
validates window sizes and identities but is not an authentication layer.
For indexed databases, implement the same find-response contract with an
indexed query rather than scanning. The provided `find_response` reads
bounded chunks (no full-table materialisation) but a search of many millions
of rows may be expensive, so applications should consider server-side indexes.

For application-managed CSV downloads, provide `virtualExportUrl` pointing
to your own authenticated CSV endpoint. This property is retained for
compatibility, but the grid no longer renders a download link. `csv_chunks()` is a pure chunk generator that
can be passed to a streaming HTTP response. No full export is materialised.

To enable direct Ctrl+A Ctrl+C for large selections, also supply
`virtualClipboardUrl="/clipboard.tsv"` on the grid and expose a GET endpoint
using the same row provider:

```python
from itertools import chain
from flask import Response, abort, request, stream_with_context
from dash_reactgrid.stateless_virtual import tsv_chunks

@app.server.route("/clipboard.tsv")
def clipboard_tsv():
    # Authenticate the caller and authorise access to this dataset.
    if not authorised_for_dataset(request, DATASET):
        abort(403)
    if request.args.get("datasetId") != DATASET:
        abort(403)
    try:
        stream = tsv_chunks(
            start=int(request.args["start"]), end=int(request.args["end"]),
            column_start=int(request.args["columnStart"]),
            column_end=int(request.args["columnEnd"]),
            column_ids=json.loads(request.args["columnIds"]),
            row_count=count_rows(), columns=columns, fetch_rows=read_rows,
        )
        first = next(stream)   # reject invalid requests before HTTP 200
        return Response(stream_with_context(chain([first], stream)),
                        mimetype="text/plain",
                        headers={"Cache-Control":"no-store"})
    except (ValueError, KeyError, StopIteration):
        abort(400)
```

Here `authorised_for_dataset` is an application-defined authorisation
function and `json` is the standard Python module. The helper fetches
small row windows and outputs tab-separated text with correct quoting of
embedded tabs, line breaks and quotation marks; it omits the column headers
for direct pasting into Excel. The response should not be cached.

Clipboard and export requests include `columnIds` in the current visible
column order. Resolve these against the original `columns` array to avoid
including hidden columns or shifting values. Pass the decoded
`columnIds` URL parameter into `csv_chunks(column_ids=...)`. Copied
text uses quoted TSV so tabs, embedded line breaks and quotation marks
round-trip when pasted. Clipboard size limits are measured in UTF-8 bytes.

Row IDs returned to the browser must be strings or JavaScript-safe integers
(up to `2**53 - 1` in magnitude). Encode larger numeric database
identifiers as strings. On exceptionally large logical datasets, the grid
keeps loaded rows at their configured height and compresses only the
offscreen scrollbar spacers.

### Delivery and undo contract

Sparse edits are small command batches, not a replacement dataset:

```json
{
  "datasetId": "assets-v1",
  "streamId": "per-tab-unique-id",
  "seq": 12,
  "attempt": 1,
  "edits": [
    {"kind": "cell", "rowId": "r2", "columnId": "value", "value": 2.5}
  ]
}
```

A successful application acknowledgement has this shape:

```json
{
  "datasetId": "assets-v1",
  "streamId": "per-tab-unique-id",
  "seq": 12,
  "status": "ok",
  "rowCount": 100001,
  "revision": 23
}
```

The browser retains an ordered, bounded pending outbox in tab-scoped
`sessionStorage` and retries an unacknowledged batch with the same
`datasetId`, `streamId`, `seq` and edits, changing only `attempt`.
This is **transient client-side edit recovery**, not a server database or
a copy of the dataset.

**A stateless callback is not enough to guarantee exactly-once effects.**
If the application commits a range deletion and the acknowledgement is lost,
a repeated *position-based* deletion could delete different rows. To offer
the current ordered, retry-safe semantics, the application's authoritative
data source must implement atomic idempotency for a batch identity, or
translate commands into intrinsically idempotent, stable-row-ID operations.
The grid does not prescribe how or where that capability is implemented.
Return `status:"ok"` only after the underlying edit has committed.

Likewise, undo of edits to unloaded rows needs their previous values.
The current `undo` command references an earlier sequence number, so an
application enabling this feature must be able to supply its inverse
operation. It may use its own existing version history or undo facility.
There is no SQLite requirement, but an application cannot support durable
undo without retaining or reconstructing the old values somehow.

After an acknowledged edit, the grid uses `rowCount` and `revision` to
invalidate the affected viewport cache and fetch the authoritative rows.
Range selections are represented by their absolute boundaries and do not
materialise all selected cells. Large paste or delete commands remain
bounded, and cross-window exports are streamed.

For temporary failures return `status:"retry"`. For rejected commands
return `status:"conflict"` or `status:"error"` with a human-readable
message. Never obtain `State("grid", "data")` in the callbacks for a
server-virtualised grid, because it would defeat virtualization.

The SQLite files under `tests/fixtures/` are **test-only adapters** used
to exercise lost acknowledgements, idempotency, inverse operations, and
cross-window editing. They are not installed dependencies, required runtime
components, or the recommended application architecture. The fixture applies
bulk fills in 250-row windows, decoding and encoding each JSON row within a
single SQLite write transaction. Although the command protocol imposes no
fixed row-count limit, very large fixture fills (for example 100,000+ rows)
can hold SQLite's writer lock for a long time. Production providers should
validate request sizes, use efficient set-based or batched updates suited to
their backing store, and preserve atomic edit acknowledgement and undo
semantics. Benchmark and set application-specific resource/time limits rather
than using this test fixture as a high-volume production storage engine.

## Editing with stable row ids

Give `rowIds` (one per row of `data`) and the grid reports every change as
edits that name rows by id, in the read-only `edits` property:

```python
{"seq": 4, "edits": [
    {"kind": "add", "rowId": "new-k3j9x0"},
    {"kind": "cell", "rowId": "new-k3j9x0", "columnId": "name", "value": "Banks"},
    {"kind": "remove", "rowIds": ["2"]},
]}
```

A server can replay them against the rows it mounted, so edits never depend
on the order the grid shows. With `rowIds`:

- `isExtendable` shows a blank row after the data; typing or pasting into it
  adds rows (ids starting `new-`), filled first from `newRow`. Its cells
  have the class `rg-ghost`.
- Right-clicking a selection offers "Delete rows".
- `selectedRowIds` holds the rows the selection covers.

Other properties:

- Columns are resizable by dragging the header boundary. New widths are
  published to Dash's `columns` property. Set `resizable: false` in a
  column definition (or `resizable=False` in Python's `Column`) to opt out.
- `readOnly` locks every cell; `lockedCells` locks `[rowId, columnId]` pairs.
- `hiddenColumns` hides columns by id; their values stay in `data`.
- A column's `editableWhen` rules lock its cells unless the row's other values
  allow them (`{"columnId": "type", "in": ["bond"]}`,
  `{"columnId": "has_credit", "truthy": true}`); such cells get `rg-cell-na`.
- Column types: `text`, `number`, `percent`, `dropdown` (with `values`),
  `checkbox`, `date` and `time`. `formatOptions` are `Intl.NumberFormat`
  options.
- Every cell carries the class `rg-col-<columnId>`.
- Pasted text without a `%` goes into a percent column as a fraction (`0.35`
  is 35%), as Excel and this grid copy values; `35%` is 35% too.
- Ctrl+Arrow jumps to the first or last data row/visible column; Ctrl+Shift+Arrow
  extends the selection to that boundary. For server-virtualized grids these
  refer to absolute dataset boundaries, without fetching all rows.
- Ctrl+D fills down from the first selected row. With just one selected cell,
  it copies the value from the cell immediately above. Locked and non-editable
  destinations are preserved; each fill is one undoable edit batch.
- To enter one value into several selected cells, select the cells, type in the
  active cell and press Shift+Enter. Target columns use their own value types;
  a single-cell Shift+Enter retains ordinary upward navigation.
- Ordinary in-memory grids allow Ctrl+D, Shift+Enter, and Delete/Backspace
  across any selected range, including more than 20,000 cells. Clipboard copy
  retains a separate size safeguard. In server-virtualized mode, Ctrl+D and Shift+Enter
  use compact, unbounded row-range commands, so an entire selected column can
  be filled without fetching offscreen rows or sending the values to Dash.
  Select a column header or use Ctrl+Space from a focused cell to select the
  full logical column, including unloaded rows. Other clipboard/edit limits
  still apply.
- Virtual Shift+Enter submits `{"kind":"fillRange","start":0,"end":100000,
  "columnIds":["rate"],"values":[0.045]}`. Virtual Ctrl+D submits
  `{"kind":"fillDown","sourceRow":0,"start":1,"end":100000,
  "columnIds":["rate"]}`, with the source row resolved by the server.
  These commands use absolute zero-based row boundaries, with an exclusive
  `end`. They are delivered through the existing durable `edits`/`editAck`
  protocol and can be undone as one logical operation.
- The Dash application must implement these range commands on its underlying
  dataset, validate dataset identity and edit permissions per destination,
  handle the operation atomically, and return an ACK only after persistence.
  Locked and conditionally non-editable destinations should be preserved.
  The optional SQLite test fixture implements this contract; the grid does
  not require SQLite or any server-side database.
- Ctrl+Z and Ctrl+Y undo and redo cell edits.

The data model (`src/lib/model.js`) has no React in it; test it with
`npm run test:js`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

### Install dependencies

If you have selected install_dependencies during the prompt, you can skip this part.

1. Install npm packages
    ```
    $ npm install
    ```
2. Create a virtual env and activate.
    ```
    $ virtualenv venv
    $ . venv/bin/activate
    ```
    _Note: venv\Scripts\activate for windows_

3. Install python packages required to build components.
    ```
    $ pip install -r requirements.txt
    ```
4. Install the python packages for testing (optional)
    ```
    $ pip install -r tests/requirements.txt
    ```

### Write your component code in `src/lib/components/DashReactGrid.react.js`.

- The demo app is in `src/demo` and you will import your example component code into your demo app.
- Test your code in a Python environment:
    1. Build your code
        ```
        $ npm run build
        ```
    2. Run and modify the `usage.py` sample dash app:
        ```
        $ python usage.py
        ```
- Write tests for your component.
    - A sample test is available in `tests/test_usage.py`, it will load `usage.py` and you can then automate interactions with selenium.
    - Run the tests with `$ pytest tests`.
    - The Dash team uses these types of integration tests extensively. Browse the Dash component code on GitHub for more examples of testing (e.g. https://github.com/plotly/dash-core-components)
- Add custom styles to your component by putting your custom CSS files into your distribution folder (`dash_reactgrid`).
    - Make sure that they are referenced in `MANIFEST.in` so that they get properly included when you're ready to publish your component.
    - Make sure the stylesheets are added to the `_css_dist` dict in `dash_reactgrid/__init__.py` so dash will serve them automatically when the component suite is requested.
- [Review your code](./review_checklist.md)

### Create a production build and publish:

1. Build your code:
    ```
    $ npm run build
    ```
2. Create a Python distribution
    ```
    $ python setup.py sdist bdist_wheel
    ```
    This will create source and wheel distribution in the generated the `dist/` folder.
    See [PyPA](https://packaging.python.org/guides/distributing-packages-using-setuptools/#packaging-your-project)
    for more information.

3. Test your tarball by copying it into a new environment and installing it locally:
    ```
    $ pip install dash_reactgrid-0.0.1.tar.gz
    ```

4. If it works, then you can publish the component to NPM and PyPI:
    1. Publish on PyPI
        ```
        $ twine upload dist/*
        ```
    2. Cleanup the dist folder (optional)
        ```
        $ rm -rf dist
        ```
    3. Publish on NPM (Optional if chosen False in `publish_on_npm`)
        ```
        $ npm publish
        ```
        _Publishing your component to NPM will make the JavaScript bundles available on the unpkg CDN. By default, Dash serves the component library's CSS and JS locally, but if you choose to publish the package to NPM you can set `serve_locally` to `False` and you may see faster load times._

5. Share your component with the community! https://community.plotly.com/c/dash
    1. Publish this repository to GitHub
    2. Tag your GitHub repository with the plotly-dash tag so that it appears here: https://github.com/topics/plotly-dash
    3. Create a post in the Dash community forum: https://community.plotly.com/c/dash
