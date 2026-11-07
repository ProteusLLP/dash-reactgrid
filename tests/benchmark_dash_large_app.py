"""Dash large-grid benchmark fixture.

Modes:
  normal: full NumPy-backed table sent in Dash layout; no paging.
  paged: full NumPy-backed table sent in Dash layout; 250-row client page.
  virtual: stateless server-generated windows, no full table transmitted.

Renderer can be reactgrid or glide; glide virtual currently falls back to
ReactGrid, and that fact must be retained in the benchmark reporting.
"""
import os
import numpy as np
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import window_response

MODE = os.environ.get("LOAD_GRID_MODE", "virtual")
RENDERER = os.environ.get("LOAD_GRID_RENDERER", "reactgrid")
N = int(os.environ.get("LOAD_GRID_ROWS", "100000"))
W = int(os.environ.get("LOAD_GRID_COLS", "12"))
PORT = int(os.environ.get("LOAD_GRID_PORT", "8096"))
TRANSPORT = os.environ.get("LOAD_GRID_TRANSPORT", "numpy")
SPARSE = os.environ.get("LOAD_GRID_SPARSE", "0") == "1"
if MODE not in ("normal","paged","virtual") or W < 1 or N < 1:
    raise ValueError("Invalid benchmark geometry")

COLUMNS = [
    {"columnId":f"c{c}","title":f"Column {c}","type":"number","width":108}
    for c in range(W)
]
kwargs = {
    "id":"grid", "renderer":RENDERER,
    "columns":COLUMNS, "persisted_props":[],
    "disableVirtualScrolling":False,
}
if MODE == "virtual":
    kwargs.update(
        data=[], virtualRowCount=N,
        virtualDatasetId=f"perf-{N}-{W}",
        virtualWindowSize=120, virtualViewportHeight=430,
        virtualRowHeight=25,
    )
else:
    # Packed NumPy avoids materialising 1.2m individual JS numeric objects
    # for transport, but ordinary mode still sends the full buffer up front.
    vals = np.arange(N*W,dtype=np.float64).reshape((N,W))
    vals /= 100.0
    kwargs.update(
        data=vals if TRANSPORT=="numpy" else vals.tolist(),
        rowIds=[f"r{i}" for i in range(N)],
    )
    if MODE == "paged": kwargs["rowPageSize"]=250
if SPARSE:
    kwargs["transmitSparseEdits"]=True
    kwargs["editDatasetId"]=f"perf-{N}-{W}"

app = Dash(__name__)
app.layout = html.Div([
    html.Div(f"mode={MODE} renderer={RENDERER} rows={N} cols={W}",id="label"),
    DashReactGrid(**kwargs),
    html.Div(id="window-status"),
    html.Div(id="edit-status"),
],style={"fontFamily":"Arial","width":"1450px"})

if MODE=="virtual":
    @app.callback(
        Output("grid","virtualData"),Output("window-status","children"),
        Input("grid","virtualRequest"),prevent_initial_call=True,
    )
    def window(request):
        def read(start,end):
            values = [[(i*W+j)/100.0 for j in range(W)]
                      for i in range(start,end)]
            return {"rowIds":[f"r{i}" for i in range(start,end)],
                    "data":values}
        answer = window_response(
            request,dataset_id=f"perf-{N}-{W}",
            row_count=N,columns=COLUMNS,fetch_rows=read)
        return answer,f"window={request['start']}:{request['end']}"

@app.callback(Output("edit-status","children"),Input("grid","edits"))
def edit_status(payload):
    if not payload: return "no edits"
    return f"edit-seq={payload.get('seq',0)} count={len(payload.get('edits',[]))}"

if __name__=="__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
