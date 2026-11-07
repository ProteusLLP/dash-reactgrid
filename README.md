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

### Transmit only sparse edits

For large datasets, enable `transmitSparseEdits=True`. The browser keeps the
edited table (including newly added or deleted rows) in local state, but
`setProps` publishes **only `edits`**, not `data` or `rowIds`. The
default is `False`, preserving the previous full-data behaviour.

```python
from dash import Input, Output, callback, html
from dash_reactgrid import DashReactGrid

grid = DashReactGrid(
    id="grid",
    columns=columns,
    data=data,
    rowIds=row_ids,             # recommended for stable edit identifiers
    rowPageSize=250,            # optional for large tables
    transmitSparseEdits=True,
)
# Add grid and html.Div(id="edit-status") to your layout.

@callback(
    Output("edit-status", "children"),
    Input("grid", "edits"),
    prevent_initial_call=True,
)
def save_edits(event):
    # Persist every {kind: "cell"/"add"/"remove", ...} in event["edits"]
    # to your server-side data store using its stable row IDs.
    # "seq" increases with each edit batch from this component instance.
    persist_changes(event["edits"])  # application-specific function
    return f"Saved edit batch {event['seq']}"
```

The `edits` payload retains its existing format:
`{"seq": 4, "edits": [{"kind":"cell","rowId":"r2","columnId":"value","value":2.5}]}`.
Row additions emit an `add` event with a generated row ID, followed by the
cell edits. Row deletions emit `remove` with a list of row IDs. The server
must apply the same `newRow` template on an `add` event. Undo and redo
publish ordinary inverse cell edits. The browser retains the updated values
across selection changes and paging.

**Important:** The `data` prop is the authoritative starting snapshot, not a
live representation of browser edits in sparse mode. A subsequent server
update to `data` or `rowIds` replaces the browser's local table, including
any unsynchronised edits, and clears undo history. Do not echo stale `data`
from an edit callback. The `data` prop is still initially sent in full,
and full data exports must come from your server's own store. Ensure edits
are saved reliably and processed in `seq` order; the component exposes the
latest edit batch, not an acknowledged queue of all outstanding changes.
Avoid including `State("grid", "data")` in callbacks processing the edits,
because doing so transmits the full table again. If Dash persistence is used,
consider `persisted_props=["columns"]`, since `data` does not represent
the edited local table.

**Remaining scalability limitation:** This is client-side paging. A large
initial `data` property is still transferred to Dash/the browser. For
datasets beyond client memory, use server-provided page data and a server-side
edit store. Select-all, clipboard copy and paste are confined to the
current page; global export belongs on the server.

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
