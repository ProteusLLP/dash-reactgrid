"""Live Dash server-virtualized grid with acknowledged sparse edits."""
import os
from pathlib import Path
from dash import Dash, Input, Output, html, no_update
from dash_reactgrid import DashReactGrid
from examples.sparse_edit_server import SparseGridStore

PORT=int(os.environ.get("VIRTUAL_RELIABLE_PORT","8063"))
DB=Path(os.environ["VIRTUAL_RELIABLE_DB"])
DATASET="virtual-rows-v1"
COLUMNS=[
    {"columnId":"name","title":"Name","type":"text","width":170},
    {"columnId":"value","title":"Value","type":"number","width":100},
]
store=SparseGridStore(DB,DATASET,COLUMNS)
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
            persisted_props=["columns"],
        ),
        html.Div(id="commit-status"),
        html.Div(id="viewport-status"),
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
