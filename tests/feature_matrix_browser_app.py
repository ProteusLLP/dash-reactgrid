"""Deterministic multi-grid Dash fixture for full Chrome interaction testing.

No database or external services. A fresh page load restores the seed rows.
"""
import json
import os
import numpy as np

from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import window_response

PORT = int(os.environ.get("GRID_MATRIX_BROWSER_PORT", "8065"))

MATRIX_COLUMNS = [
    {"columnId": "text", "title": "Text", "type": "text", "width": 160,
     "tooltip": "A free-form text value"},
    {"columnId": "amount", "title": "Amount", "type": "number", "width": 120,
     "tooltip": "Amount in pounds"},
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
GROUPED_COLUMNS = [
    {"columnId": "uk1", "title": "1y", "type": "number",
     "headerPath": ["Rates", "UK"], "width": 100},
    {"columnId": "uk5", "title": "5y", "type": "number",
     "headerPath": ["Rates", "UK"], "width": 100},
    {"columnId": "us1", "title": "1y", "type": "number",
     "headerPath": ["Rates", "US"], "width": 100},
    {"columnId": "memo", "title": "Memo", "type": "text",
     "headerPath": ["Notes"], "width": 130},
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

VIRTUAL_REVIEW_COLUMNS = [
    {"columnId": "label", "title": "Label", "type": "text", "width": 160,
     "tooltip": "Server-backed label"},
    {"columnId": "day", "title": "Date", "type": "date", "width": 140},
    {"columnId": "clock", "title": "Time", "type": "time", "width": 140},
]
VIRTUAL_REVIEW_DATA = [
    ["Existing", "2026-11-01", "2026-11-01T12:00:00Z"],
    ["Second", "2026-11-02", "2026-11-02T14:30:00Z"],
]
VIRTUAL_REVIEW_DATASET = "review-virtual-types-v1"

NUMERIC_COLUMNS = [
    {"columnId": "a", "title": "A", "type": "number", "width": 120},
    {"columnId": "b", "title": "B", "type": "number", "width": 120},
]
NUMERIC_DATA = np.array([[1.25, 2.5], [-4.5, 3.75]], dtype=np.float64)
NUMERIC_VIRTUAL_DATA = np.arange(40, dtype=np.float32).reshape(20, 2)
NUMERIC_VIRTUAL_DATASET = "numeric-virtual-v1"


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
        html.H3("Grouped headers"),
        DashReactGrid(
            id="grouped", columns=GROUPED_COLUMNS,
            data=[[1.5, 2.5, 3.5, "First"], [4.5, 5.5, 6.5, "Second"]],
            rowIds=["g0", "g1"], stickyTopRows=1, persisted_props=[],
        ),
        html.Pre(id="grouped-state"),
        html.H3("Grouped paged"),
        DashReactGrid(
            id="grouped-paged", columns=GROUPED_COLUMNS,
            data=[[1, 2, 3, "A"], [4, 5, 6, "B"],
                  [7, 8, 9, "C"], [10, 11, 12, "D"]],
            rowIds=["pg0", "pg1", "pg2", "pg3"],
            rowPageSize=2, stickyTopRows=1, persisted_props=[],
        ),
        html.Pre(id="grouped-paged-state"),

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
        html.H3("Review virtual cell types"),
        DashReactGrid(
            id="review-virtual", columns=VIRTUAL_REVIEW_COLUMNS,
            data=[], rowIds=[],
            virtualRowCount=len(VIRTUAL_REVIEW_DATA),
            virtualDatasetId=VIRTUAL_REVIEW_DATASET,
            virtualWindowSize=20, virtualViewportHeight=200,
            transmitSparseEdits=True, editDatasetId=VIRTUAL_REVIEW_DATASET,
            persisted_props=[],
        ),
        html.Pre(id="review-virtual-edits"),
        html.H3("NumPy-backed normal grid"),
        DashReactGrid(
            id="numeric", columns=NUMERIC_COLUMNS, data=NUMERIC_DATA,
            rowIds=["n0", "n1"], persisted_props=[],
        ),
        html.Pre(id="numeric-state"),
        html.H3("NumPy-backed virtual grid"),
        DashReactGrid(
            id="numeric-virtual", columns=NUMERIC_COLUMNS, data=[],
            virtualRowCount=len(NUMERIC_VIRTUAL_DATA),
            virtualDatasetId=NUMERIC_VIRTUAL_DATASET,
            virtualWindowSize=20, virtualViewportHeight=200,
            persisted_props=[],
        ),
    ], style={"fontFamily": "Arial", "padding": "12px"})


app.layout = layout


def attach_state(grid_id, status_id):
    @app.callback(
        Output(status_id, "children"),
        Input(grid_id, "data"), Input(grid_id, "rowIds"),
        Input(grid_id, "edits"),
        Input(grid_id, "selectedRowIds"), Input(grid_id, "selectedCell"),
    )
    def show(rows, row_ids, edits, selected, focused):
        return json.dumps({
            "data": rows, "rowIds": row_ids,
            "edits": edits, "selectedRowIds": selected,
            "selectedCell": focused,
        }, ensure_ascii=False)


@app.callback(
    Output("review-virtual", "virtualData"),
    Input("review-virtual", "virtualRequest"),
    prevent_initial_call=True,
)
def review_virtual_window(request):
    def read(start, end):
        return {
            "rowIds": [f"vr-{i}" for i in range(start, end)],
            "data": VIRTUAL_REVIEW_DATA[start:end],
        }

    return window_response(
        request, dataset_id=VIRTUAL_REVIEW_DATASET,
        row_count=len(VIRTUAL_REVIEW_DATA),
        columns=VIRTUAL_REVIEW_COLUMNS, fetch_rows=read,
    )


@app.callback(
    Output("review-virtual-edits", "children"),
    Input("review-virtual", "edits"),
)
def review_virtual_edits(batch):
    return json.dumps(batch, ensure_ascii=False)


@app.callback(
    Output("numeric-virtual", "virtualData"),
    Input("numeric-virtual", "virtualRequest"),
    prevent_initial_call=True,
)
def numeric_virtual_window(request):
    return window_response(
        request, dataset_id=NUMERIC_VIRTUAL_DATASET,
        row_count=len(NUMERIC_VIRTUAL_DATA), columns=NUMERIC_COLUMNS,
        fetch_rows=lambda a, b: {
            "rowIds": [f"nr-{i}" for i in range(a, b)],
            "data": NUMERIC_VIRTUAL_DATA[a:b],
        },
    )


attach_state("grouped", "grouped-state")
attach_state("grouped-paged", "grouped-paged-state")
attach_state("numeric", "numeric-state")
attach_state("matrix", "matrix-state")
attach_state("target", "target-state")
attach_state("paged", "paged-state")
attach_state("readonly", "readonly-state")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
