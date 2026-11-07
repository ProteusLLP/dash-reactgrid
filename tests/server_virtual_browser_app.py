"""Live Dash app for browser verification of server-backed continuous scrolling."""
import os
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid

PORT = int(os.environ.get("VIRTUAL_BROWSER_PORT", "8061"))
TOTAL_ROWS = 100_000
COLUMNS = [
    {"columnId":"name", "title":"Name", "type":"text", "width":160},
    {"columnId":"value", "title":"Value", "type":"number", "width":100},
]
app = Dash(__name__)
app.layout = html.Div([
    DashReactGrid(
        id="grid",
        columns=COLUMNS,
        data=[],
        virtualRowCount=TOTAL_ROWS,
        virtualDatasetId="synthetic-100k-v1",
        virtualRowHeight=25,
        virtualWindowSize=120,
        virtualViewportHeight=400,
    ),
    html.Div(id="requested-rows"),
])

@app.callback(
    Output("grid","virtualData"),
    Output("requested-rows","children"),
    Input("grid","virtualRequest"),
    prevent_initial_call=True,
)
def fetch_window(request):
    if not request:
        raise ValueError("Missing viewport request")
    start = request["start"]
    end = request["end"]
    if request["datasetId"] != "synthetic-100k-v1" or not (0 <= start < end <= TOTAL_ROWS):
        raise ValueError("Invalid viewport request")
    # Generate only the requested rows. No giant list is ever sent to Dash.
    return {
        "datasetId": request["datasetId"],
        "requestId": request["requestId"],
        "start": start,
        "rowIds": [f"r{i}" for i in range(start,end)],
        "data": [[f"Row {i}",float(i)] for i in range(start,end)],
    }, f"Fetched {start}:{end} ({end-start} rows)"

if __name__ == "__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
