"""Chrome fixture: fully resident typed-array grid with windowed rendering."""
import json
import os

import numpy as np
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid

COUNT=100_000
PORT=int(os.environ.get("GRID_CLIENT_VIRTUAL_PORT","8078"))
DATA=np.arange(COUNT*8,dtype=np.float64).reshape(COUNT,8)
COLUMNS=[{"columnId":str(i),"title":str(i),"type":"number","width":125}
         for i in range(8)]
app=Dash(__name__)
app.layout=html.Div([
    DashReactGrid(
        id="client-grid",columns=COLUMNS,data=DATA,
        rowIds=[f"r{i}" for i in range(COUNT)],
        virtualizationMode="client",virtualRowHeight=25,
        virtualWindowSize=120,virtualViewportHeight=420,
        persisted_props=[],transmitSparseEdits=True,
        editDatasetId="client-window-browser-fixture",
    ),
    html.Pre(id="client-events"),
])

@app.callback(
    Output("client-grid","editAck"),Output("client-events","children"),
    Input("client-grid","edits"),prevent_initial_call=True,
)
def acknowledge(batch):
    if not batch or "seq" not in batch:
        return None,""
    ack={"datasetId":"client-window-browser-fixture","seq":batch["seq"],
         "streamId":batch["streamId"],"status":"ok"}
    return ack,json.dumps(batch)

if __name__=="__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
