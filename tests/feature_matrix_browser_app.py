"""Deterministic multi-grid Dash fixture for full Chrome interaction testing.

No database or external services. A fresh page load restores the seed rows.
"""
import json
import os
import time
import numpy as np

from dash import Dash, Input, Output, State, ctx, html, no_update
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import find_response, window_response

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

ACK_FIND_COLUMNS = [{"columnId":"label","title":"Label","type":"text"}]
ACK_FIND_DATASET = "find-ack-original"
ACK_FIND_DATA = [["A"],["B match"],["C"]]
ACK_FIND_REPLACEMENT = [["X"],["Y"],["Z"]]


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
        html.H3("Find after reordering"),
        html.Button("Reverse find rows",id="reverse-find-rows"),
        DashReactGrid(
            id="find-reorder",columns=TWO_COLUMNS,
            data=[["First",1],["Second",2],["Third",3]],
            rowIds=["first","second","third"],persisted_props=[],
        ),
        html.Pre(id="find-reorder-state"),
        html.H3("Find across pages after reordering"),
        html.Button("Reverse paged find rows", id="reverse-find-paged-rows"),
        DashReactGrid(
            id="find-reorder-paged", columns=TWO_COLUMNS,
            data=[["First",1],["Second",2],["Third",3],["Fourth",4]],
            rowIds=["first","second","third","fourth"], rowPageSize=2,
            persisted_props=[],
        ),
        html.Pre(id="find-reorder-paged-state"),
        html.H3("Find after hiding columns"),
        html.Button("Hide first column",id="hide-find-label",n_clicks=0),
        html.Button("Hide matched column",id="hide-find-match-column",n_clicks=0),
        DashReactGrid(
            id="find-column-rebase",
            columns=[
                {"columnId":"label","title":"Label","type":"text"},
                {"columnId":"value","title":"Value","type":"text"},
                {"columnId":"third","title":"Third","type":"text"},
            ],
            data=[["A","B match","C"]],
            rowIds=["column-rebase-row"],persisted_props=[],
        ),
        html.Pre(id="find-column-rebase-state"),
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
        html.Pre(id="review-virtual-selection"),
        html.Pre(id="review-virtual-find-request"),
        html.Button("Hide virtual label",id="hide-virtual-label",n_clicks=0),
        html.H3("Find ACK and dataset replacement"),
        html.Button("Acknowledge deletion",id="ack-delete-find-row",n_clicks=0),
        html.Button("Replace dataset",id="replace-find-dataset",n_clicks=0),
        DashReactGrid(
            id="ack-find-virtual",columns=ACK_FIND_COLUMNS,
            data=[],rowIds=[],virtualRowCount=3,
            virtualDatasetId=ACK_FIND_DATASET,editDatasetId=ACK_FIND_DATASET,
            virtualWindowSize=20,virtualViewportHeight=200,
            transmitSparseEdits=True,persisted_props=[],
        ),
        html.Pre(id="ack-find-state"),
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

@app.callback(
    Output("find-reorder","data"),
    Output("find-reorder","rowIds"),
    Input("reverse-find-rows","n_clicks"),
    prevent_initial_call=True,
)
def change_find_row_order(n_clicks):
    values=[["First",1],["Second",2],["Third",3]]
    ids=["first","second","third"]
    return (list(reversed(values)),list(reversed(ids))) if n_clicks % 2 else (values,ids)


@app.callback(
    Output("find-reorder-paged","data"),
    Output("find-reorder-paged","rowIds"),
    Input("reverse-find-paged-rows","n_clicks"),
    prevent_initial_call=True,
)
def change_paged_find_row_order(n_clicks):
    values=[["First",1],["Second",2],["Third",3],["Fourth",4]]
    ids=["first","second","third","fourth"]
    return (list(reversed(values)),list(reversed(ids))) if n_clicks % 2 else (values,ids)


@app.callback(
    Output("find-column-rebase","hiddenColumns"),
    Input("hide-find-label","n_clicks"),
    Input("hide-find-match-column","n_clicks"),
)
def hide_find_label(n_clicks, hide_match):
    if ctx.triggered_id == "hide-find-match-column" and hide_match % 2:
        return ["value"]
    return ["label"] if n_clicks % 2 else []


@app.callback(
    Output("review-virtual","hiddenColumns"),
    Input("hide-virtual-label","n_clicks"),
)
def hide_virtual_label(n_clicks):
    return ["label"] if n_clicks % 2 else []





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
    Output("review-virtual", "virtualFindData"),
    Input("review-virtual", "virtualFindRequest"),
    prevent_initial_call=True,
)
def review_virtual_find(request):
    if request.get("query") == "Existing":
        # Keep the async request pending long enough to test repeated Enter.
        time.sleep(0.65)
    def read(start, end):
        return {
            "rowIds": [f"vr-{i}" for i in range(start, end)],
            "data": VIRTUAL_REVIEW_DATA[start:end],
        }

    return find_response(
        request, dataset_id=VIRTUAL_REVIEW_DATASET,
        row_count=len(VIRTUAL_REVIEW_DATA),
        columns=VIRTUAL_REVIEW_COLUMNS, fetch_rows=read,
    )


@app.callback(
    Output("review-virtual-find-request", "children"),
    Input("review-virtual", "virtualFindRequest"),
)
def show_review_find_request(request):
    return json.dumps(request or {}, ensure_ascii=False)


@app.callback(
    Output("review-virtual-edits", "children"),
    Input("review-virtual", "edits"),
)
def review_virtual_edits(batch):
    return json.dumps(batch, ensure_ascii=False)


@app.callback(
    Output("review-virtual-selection", "children"),
    Input("review-virtual", "selectedRange"),
    Input("review-virtual", "selectedRowIds"),
    Input("review-virtual", "selectedCell"),
)
def review_virtual_selection(ranges, ids, selected):
    return json.dumps({"selectedRange":ranges, "selectedRowIds":ids,
                       "selectedCell":selected},ensure_ascii=False)


def ack_find_values(dataset_id, count):
    if dataset_id != ACK_FIND_DATASET:
        return ACK_FIND_REPLACEMENT
    return ACK_FIND_DATA[:1] + ACK_FIND_DATA[2:] if count == 2 else ACK_FIND_DATA


@app.callback(
    Output("ack-find-virtual", "virtualDatasetId"),
    Output("ack-find-virtual", "virtualRowCount"),
    Output("ack-find-virtual", "editAck"),
    Input("replace-find-dataset", "n_clicks"),
    Input("ack-delete-find-row", "n_clicks"),
    prevent_initial_call=True,
)
def change_ack_find_dataset(replacements, acks):
    if ctx.triggered_id == "replace-find-dataset":
        return "find-ack-replacement",3,no_update
    return no_update,2,{"status":"ok","datasetId":ACK_FIND_DATASET,
                        "revision":acks,"rowCount":2}


@app.callback(
    Output("ack-find-virtual", "virtualData"),
    Input("ack-find-virtual", "virtualRequest"),
    State("ack-find-virtual", "virtualRowCount"),
    prevent_initial_call=True,
)
def ack_find_window(request, count):
    values=ack_find_values(request["datasetId"],count)
    return window_response(
        request,dataset_id=request["datasetId"],row_count=len(values),
        columns=ACK_FIND_COLUMNS,
        fetch_rows=lambda a,b:{"rowIds":[f"ar-{i}" for i in range(a,b)],
                               "data":values[a:b]},
    )


@app.callback(
    Output("ack-find-virtual", "virtualFindData"),
    Input("ack-find-virtual", "virtualFindRequest"),
    State("ack-find-virtual", "virtualRowCount"),
    prevent_initial_call=True,
)
def ack_find_response(request, count):
    values=ack_find_values(request["datasetId"],count)
    return find_response(
        request,dataset_id=request["datasetId"],row_count=len(values),
        columns=ACK_FIND_COLUMNS,
        fetch_rows=lambda a,b:{"rowIds":[f"ar-{i}" for i in range(a,b)],
                               "data":values[a:b]},
    )


@app.callback(
    Output("ack-find-state", "children"),
    Input("ack-find-virtual", "selectedRange"),
    Input("ack-find-virtual", "selectedRowIds"),
    Input("ack-find-virtual", "selectedCell"),
    Input("ack-find-virtual", "virtualSelection"),
    Input("ack-find-virtual", "edits"),
)
def ack_find_state(ranges, ids, selected, global_selection, edits):
    return json.dumps({"selectedRange":ranges, "selectedRowIds":ids,
                       "selectedCell":selected,"virtualSelection":global_selection,
                       "edits":edits},ensure_ascii=False)


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
attach_state("find-reorder", "find-reorder-state")
attach_state("find-reorder-paged", "find-reorder-paged-state")
attach_state("find-column-rebase", "find-column-rebase-state")
attach_state("numeric", "numeric-state")
attach_state("matrix", "matrix-state")
attach_state("target", "target-state")
attach_state("paged", "paged-state")
attach_state("readonly", "readonly-state")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
