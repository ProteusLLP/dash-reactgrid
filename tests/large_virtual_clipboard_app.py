"""Stateless browser fixture for copying 25,000 unloaded rows to the clipboard."""
import json
import os
from itertools import chain
from dash import Dash, Input, Output, html
from flask import Response, abort, request, stream_with_context
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import window_response, tsv_chunks

PORT=int(os.environ.get("GRID_STREAM_COPY_PORT","8072"))
DATASET="virtual-copy-v1"
COUNT=25_050
COLUMNS=[
    {"columnId":"label","title":"Label","type":"text","width":180},
    {"columnId":"hidden","title":"Hidden","type":"text","width":100},
    {"columnId":"amount","title":"Amount","type":"number","width":100},
]

def read_rows(start,end):
    return {"rowIds":[f"r{i}" for i in range(start,end)],
            "data":[[f"Row {i}","private",i] for i in range(start,end)]}

app=Dash(__name__)
app.layout=html.Div([
    DashReactGrid(id="grid",columns=COLUMNS,data=[],rowIds=[],
                  hiddenColumns=["hidden"],virtualRowCount=COUNT,
                  virtualDatasetId=DATASET,virtualWindowSize=100,
                  virtualViewportHeight=420,
                  virtualClipboardUrl="/clipboard.tsv",
                  persisted_props=[]),
    html.Div(id="window-status"),
])

@app.callback(Output("grid","virtualData"),Output("window-status","children"),
              Input("grid","virtualRequest"),prevent_initial_call=True)
def fetch_window(req):
    return window_response(req,dataset_id=DATASET,row_count=COUNT,
                           columns=COLUMNS,fetch_rows=read_rows), "Window loaded"

@app.server.route("/clipboard.tsv")
def clipboard_export():
    # No authentication in this test fixture. Production applications MUST
    # authenticate users and authorise the requested dataset and selection.
    if request.args.get("datasetId")!=DATASET:abort(403)
    try:
        args=request.args
        names=json.loads(args["columnIds"])
        stream=tsv_chunks(
            start=int(args["start"]),end=int(args["end"]),
            column_start=int(args["columnStart"]),
            column_end=int(args["columnEnd"]),row_count=COUNT,
            columns=COLUMNS,column_ids=names,fetch_rows=read_rows)
        # Validate before sending HTTP 200 and streaming any response bytes.
        first=next(stream)
        return Response(stream_with_context(chain([first],stream)),
                        mimetype="text/plain",
                        headers={"Cache-Control":"no-store",
                                 "X-Content-Type-Options":"nosniff"})
    except (ValueError,KeyError,StopIteration,TypeError):
        abort(400)

if __name__=="__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
