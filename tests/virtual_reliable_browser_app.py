"""Live Dash server-virtualized grid with acknowledged sparse edits."""
import os
from pathlib import Path
from dash import Dash, Input, Output, html, no_update
from flask import Response, request, abort, stream_with_context
from dash_reactgrid import DashReactGrid
from examples.virtual_grid_store import VirtualGridStore

PORT=int(os.environ.get("VIRTUAL_RELIABLE_PORT","8063"))
DB=Path(os.environ["VIRTUAL_RELIABLE_DB"])
DATASET="virtual-rows-v1"
COLUMNS=[
    {"columnId":"name","title":"Name","type":"text","width":170},
    {"columnId":"value","title":"Value","type":"number","width":100},
]
store=VirtualGridStore(DB,DATASET,COLUMNS)
store.seed_once([[f"Row {i}",i] for i in range(1000)],[f"r{i}" for i in range(1000)])
WITHHOLD_ACK=os.environ.get("VIRTUAL_RELIABLE_DROP_ACK")=="1"
withheld=set()
app=Dash(__name__)

def layout():
    return html.Div([
        DashReactGrid(
            id="grid",columns=COLUMNS,data=[],rowIds=[],
            virtualRowCount=store.row_count(),
            virtualDatasetId=DATASET,
            virtualRowHeight=25,virtualWindowSize=100,
            virtualViewportHeight=420,
            transmitSparseEdits=True,editDatasetId=DATASET,
            virtualExportUrl="/export.csv",
            persisted_props=["columns"],
        ),
        html.Div(id="commit-status"),
        html.Div(id="viewport-status"),
        html.Div(id="range-status"),
    ])
app.layout=layout

@app.callback(Output("grid","virtualData"),Output("viewport-status","children"),
              Input("grid","virtualRequest"),prevent_initial_call=True)
def fetch_window(request):
    start,end=request["start"],request["end"]
    if request["datasetId"]!=DATASET:
        return {"datasetId":request["datasetId"],"requestId":request["requestId"],
                "start":start,"error":"Dataset mismatch"}, "Invalid dataset"
    window=store.read_range(start,end)
    return {
        "datasetId":DATASET,"requestId":request["requestId"],"start":start,
        **window,
    }, f"Fetched {start}:{end}"

@app.callback(Output("grid","virtualRangeData"),Output("range-status","children"),
              Input("grid","virtualRangeRequest"),prevent_initial_call=True)
def copy_range(request):
    if not request:
        raise ValueError("Missing clipboard request")
    identity={key:request[key] for key in
              ("datasetId","requestId","start","end","columnStart","columnEnd")}
    if request["datasetId"]!=DATASET:
        return {**identity,"error":"Dataset mismatch"}, "Copy request rejected: dataset"
    try:
        text=store.copy_range(request["start"],request["end"],
                              request["columnStart"],request["columnEnd"])
        return {**identity,"text":text}, f"Copy prepared {request['start']}:{request['end']}"
    except ValueError as error:
        return {**identity,"error":str(error)}, "Copy error: "+str(error)

@app.server.route("/export.csv")
def download_csv():
    # This test endpoint has no authentication. Production applications must
    # authorise the requesting user and dataset before streaming records.
    try:
        if request.args.get("datasetId")!=DATASET:abort(403)
        bounds=[int(request.args[n]) for n in
                ("start","end","columnStart","columnEnd")]
        stream=store.export_csv(*bounds)
        return Response(stream_with_context(stream),mimetype="text/csv",
                        headers={"Content-Disposition":
                                 "attachment; filename=selected-grid-rows.csv"})
    except (ValueError,KeyError):
        abort(400)

@app.callback(Output("grid","editAck"),Output("commit-status","children"),
              Input("grid","edits"),prevent_initial_call=True)
def persist(batch):
    result=store.apply(batch)
    if WITHHOLD_ACK and result["status"]=="ok" and not withheld:
        withheld.add((batch["streamId"],batch["seq"]))
        return no_update,f"Stored without ACK: {batch['seq']}"
    return result,f"Committed: {batch['seq']} / {result['status']}"

if __name__=="__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
