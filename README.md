# Dash ReactGrid

Dash ReactGrid is a Dash component library.

Get started with:
1. Install Dash and its dependencies: https://dash.plotly.com/installation
2. Run `python usage.py`
3. Visit http://localhost:8050 in your web browser

## Very large tables

ReactGrid 4.1.x builds an internal cell matrix for every supplied cell,
including when virtual scrolling is enabled. For 100k rows or millions of
cells, **use `rowPageSize=250`** to limit that work. The grid displays page
controls (previous/next and direct page navigation). Row IDs and edits still
refer to the original dataset, including edits on later pages. The extension
row appears only on the last page; selection, copying, filling and pasting are
confined to the current page (pasting beyond the last page is still allowed on
extendable tables). Page navigation clears the previous selection.

```python
DashReactGrid(
    id="large-table",
    columns=columns,
    data=rows,
    rowIds=row_ids,
    rowPageSize=250,
    transmitSparseEdits=True,
    disableVirtualScrolling=False,
)
```

The renderer now shares number/date formatters and dropdown options across
cells in each column. Edits use copy-on-write and only clone changed rows.
For smaller grids, `disableVirtualScrolling=False` can reduce DOM overhead,
although it does not reduce ReactGrid's internal cell matrix.

### Reliable sparse-edit transmission

For large grids, enable `transmitSparseEdits=True` with a stable `id`,
`editDatasetId`, and a complete, stable `rowIds` array. The browser keeps
edited data in memory, but **never returns the full `data` property** on
edits. The default remains `transmitSparseEdits=False`, which retains
the original full-data callback behaviour.

```python
from dash import Input, Output, callback
from dash_reactgrid import DashReactGrid
from examples.sparse_edit_server import SparseGridStore

store = SparseGridStore(
    "grid-edits.sqlite3", "pricing-v1", columns,
    new_row=new_row,
)
# Seed only once when creating a new dataset. After that, always load
# the authoritative snapshot from your persistent database.
store.seed_once(initial_data, initial_row_ids)
snapshot = store.read()

grid = DashReactGrid(
    id="grid",
    columns=columns,
    data=snapshot["data"],
    rowIds=snapshot["rowIds"],
    newRow=new_row,
    isExtendable=True,
    rowPageSize=250,
    transmitSparseEdits=True,
    editDatasetId="pricing-v1",
)

@callback(
    Output("grid", "editAck"),
    Input("grid", "edits"),
    prevent_initial_call=True,
)
def save_edits(batch):
    return store.apply(batch)
```

`examples/sparse_edit_server.py` demonstrates a **transactional** SQLite
backend. An edit event has this shape:

```json
{
  "datasetId": "pricing-v1",
  "streamId": "cryptographically-generated-per-editor-id",
  "seq": 12,
  "attempt": 1,
  "edits": [
    {"kind": "cell", "rowId": "r2", "columnId": "amount", "value": 2.5}
  ]
}
```

After committing the whole batch (including its idempotency receipt) in the
same database transaction, the callback returns:

```json
{
  "datasetId": "pricing-v1",
  "streamId": "cryptographically-generated-per-editor-id",
  "seq": 12,
  "status": "ok"
}
```

Only a matching `status: "ok"` ACK removes that batch from the browser's
outbox. The component sends one batch at a time, in order. Unacknowledged
batches are retained in browser `sessionStorage`, retried automatically
with the same `streamId` and `seq` but an incremented `attempt`, and
replayed locally after a reload of the same browser tab. The server must
deduplicate by `(datasetId, streamId, seq)`, verify the payload has not
changed, and store the receipt atomically with the edits. That prevents
duplicate inserts/deletes if the server committed but its ACK was lost.
The component displays unsaved counts and blocks further edits on a server
conflict, corrupt storage, or exhausted storage quota rather than dropping
pending changes. Changes made through undo/redo are new ordered batches.

Use `status: "retry"` for temporary failures, allowing automatic retries,
and `status: "error"` or `"conflict"` for problems requiring intervention
(the user is shown the reason and can retry after it has been resolved).

**Operational requirements:** The Dash callback must not take
`State("grid", "data")`, since that would transmit the entire table.
The callback must access a durable shared database and return an ACK only
after a committed transaction. Do not construct the store per request,
reset server data after each edit, echo stale `data`, or return an ACK from
a fire-and-forget task. On page reload, load the latest authoritative
dataset from the store. `data` and `rowIds` prop updates are authoritative:
unacknowledged batches are replayed over them, or editing is blocked if they
cannot be reconciled. A persistent user/editor identity and application
authorization are separate concerns; do not trust a client-supplied
`datasetId` to authorize access.

**Limits:** `sessionStorage` normally survives reloads in the same tab,
but not closing that tab or clearing browser data. The component warns
before navigating away while edits remain unacknowledged, but no browser
storage can provide a guaranteed recovery service. The example uses
single-editor or last-writer-wins semantics across different streams; it
does **not** implement collaborative editing conflict resolution. If
multiple concurrent editors need to preserve all changes, add optimistic
row versions and conflict handling in the backend. Large initial datasets
are still fully transferred to the browser; true server-side paging remains
separate work. Full-table exports should come from the server.

In sparse mode, Dash persistence should generally use
`persisted_props=["columns"]`, since the `data` prop is an initial
snapshot rather than the current edited table.

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
