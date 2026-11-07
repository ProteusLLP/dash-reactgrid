"""A small live Dash app for the browser-level sparse edit protocol test."""
import os
from pathlib import Path

from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid
from examples.sparse_edit_server import SparseGridStore

DB = Path(os.environ["SPARSE_BROWSER_DB"])
PORT = int(os.environ.get("SPARSE_BROWSER_PORT", "8059"))
COLUMNS = [
    {"columnId": "name", "title": "Name", "type": "text", "width": 160},
    {"columnId": "value", "title": "Value", "type": "number", "width": 100},
]
store = SparseGridStore(DB, "browser-test", COLUMNS, new_row={"value": 0})
store.seed_once([["Alpha", 1], ["Beta", 2]], ["r1", "r2"])

app = Dash(__name__)
def layout():
    snapshot = store.read()
    return html.Div([
        DashReactGrid(
            id="grid", columns=COLUMNS, data=snapshot["data"],
            rowIds=snapshot["rowIds"], isExtendable=True,
            newRow={"value": 0}, editDatasetId="browser-test",
            transmitSparseEdits=True,
            rowPageSize=2, stickyTopRows=1,
            disableVirtualScrolling=False,
            persisted_props=["columns"],
        ),
        html.Div(id="last-commit"),
    ])
app.layout = layout

@app.callback(Output("grid", "editAck"), Output("last-commit", "children"),
              Input("grid", "edits"), prevent_initial_call=True)
def save(batch):
    response = store.apply(batch)
    return response, "Committed: " + str(response["seq"]) + " / " + response["status"]

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
