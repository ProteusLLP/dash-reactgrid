"""Live Dash app for browser verification of server-backed continuous scrolling."""
import os
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid
from examples.stateless_virtual_callbacks import window_response

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
    def rows_for(start, end):
        # Pure, stateless example provider: the index is authoritative.
        # This generates only the requested bounded window.
        return {
            "rowIds": [f"r{i}" for i in range(start, end)],
            "data": [[f"Row {i}", float(i)] for i in range(start, end)],
        }

    response = window_response(
        request, dataset_id="synthetic-100k-v1",
        row_count=TOTAL_ROWS, columns=COLUMNS, fetch_rows=rows_for,
    )
    start, end = request["start"], request["end"]
    return response, f"Fetched {start}:{end} ({end-start} rows)"

if __name__ == "__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
