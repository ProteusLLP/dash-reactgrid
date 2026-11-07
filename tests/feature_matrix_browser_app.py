"""Deterministic multi-grid Dash fixture for full Chrome interaction testing.

No database or external services. A fresh page load restores the seed rows.
"""
import json
import os

from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid

PORT = int(os.environ.get("GRID_MATRIX_BROWSER_PORT", "8065"))

MATRIX_COLUMNS = [
    {"columnId": "text", "title": "Text", "type": "text", "width": 160},
    {"columnId": "amount", "title": "Amount", "type": "number", "width": 120},
    {"columnId": "custom", "title": "Custom", "type": "customnumber", "width": 100},
    {"columnId": "percent", "title": "Percent", "type": "percent", "width": 110},
    {"columnId": "choice", "title": "Choice", "type": "dropdown", "width": 145,
     "values": [
         {"label": "In progress", "value": "open"},
         {"label": "Finished", "value": "closed"},
     ]},
    {"columnId": "flag", "title": "Flag", "type": "checkbox", "width": 85},
    {"columnId": "day", "title": "Date", "type": "date", "width": 135},
    {"columnId": "clock", "title": "Time", "type": "time", "width": 135},
    {"columnId": "conditional", "title": "Conditional", "type": "text",
     "editableWhen": [{"columnId": "choice", "in": ["open"]}]},
    {"columnId": "fixed", "title": "Fixed", "type": "text", "nonEditable": True},
    {"columnId": "secret", "title": "Secret", "type": "text"},
]
MATRIX_DATA = [
    ["Alpha", 10.5, 2.25, .25, "open", True, "2026-11-01",
     "2026-11-01T12:00:00Z", "Enabled", "Immutable", "not-visible"],
    ["Beta", 20, 3.5, .5, "closed", False, "2026-11-02",
     "2026-11-02T14:30:00Z", "Disabled", "Immutable", "not-visible"],
]
TWO_COLUMNS = [
    {"columnId": "label", "title": "Label", "type": "text", "width": 180},
    {"columnId": "value", "title": "Value", "type": "number", "width": 110},
]
SOURCE_DATA = [
    ['A "quoted"', 12.5],
    ["Tab\tand\nnewline", 25],
]
TARGET_DATA = [
    ["Target 1", 1],
    ["Target 2", 2],
]
PAGE_DATA = [[f"Page row {i}", i] for i in range(11)]

app = Dash(__name__)


def layout():
    return html.Div([
        html.H3("Matrix"),
        DashReactGrid(
            id="matrix", columns=MATRIX_COLUMNS, data=MATRIX_DATA,
            rowIds=["r1", "r2"], hiddenColumns=["secret"],
            lockedCells=[["r1", "amount"]],
            isExtendable=True,
            newRow={"choice": "open", "flag": False},
            dropdownMenuPortal=True, stickyTopRows=1,
            style={"maxHeight": "400px", "overflow": "auto"},
            persisted_props=[],
        ),
        html.Pre(id="matrix-state"),
        html.H3("Clipboard source"),
        DashReactGrid(
            id="source", columns=TWO_COLUMNS, data=SOURCE_DATA,
            rowIds=["source-1", "source-2"], stickyTopRows=1,
            persisted_props=[],
        ),
        html.H3("Clipboard destination"),
        DashReactGrid(
            id="target", columns=TWO_COLUMNS, data=TARGET_DATA,
            rowIds=["target-1", "target-2"], isExtendable=True,
            newRow={"value": 0}, stickyTopRows=1,
            persisted_props=[],
        ),
        html.Pre(id="target-state"),
        html.H3("Paged"),
        DashReactGrid(
            id="paged", columns=TWO_COLUMNS, data=PAGE_DATA,
            rowIds=[f"p{i}" for i in range(11)],
            rowPageSize=4, isExtendable=True, stickyTopRows=1,
            persisted_props=[],
        ),
        html.Pre(id="paged-state"),
        html.H3("Read only"),
        DashReactGrid(
            id="readonly", columns=TWO_COLUMNS, data=[["Protected", 42]],
            rowIds=["protected"], readOnly=True, isExtendable=True,
            persisted_props=[],
        ),
        html.Pre(id="readonly-state"),
    ], style={"fontFamily": "Arial", "padding": "12px"})


app.layout = layout


def attach_state(grid_id, status_id):
    @app.callback(
        Output(status_id, "children"),
        Input(grid_id, "data"), Input(grid_id, "rowIds"),
        Input(grid_id, "edits"),
        Input(grid_id, "selectedRowIds"), Input(grid_id, "selectedCell"),
        Input(grid_id, "selectedRange"),
    )
    def show(rows, row_ids, edits, selected, focused, selection):
        return json.dumps({
            "data": rows, "rowIds": row_ids,
            "edits": edits, "selectedRowIds": selected,
            "selectedCell": focused,
            "selectedRange": selection,
        }, ensure_ascii=False)


attach_state("matrix", "matrix-state")
attach_state("target", "target-state")
attach_state("paged", "paged-state")
attach_state("readonly", "readonly-state")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
