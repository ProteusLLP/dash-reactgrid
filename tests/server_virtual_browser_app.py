"""Live Dash app for browser verification of server-backed continuous scrolling."""
import os
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import window_response, find_response

PORT = int(os.environ.get("VIRTUAL_BROWSER_PORT", "8061"))
TOTAL_ROWS = 100_000
COMPRESSED_ROWS = 10_000_000
COMPRESSED_DATASET = "synthetic-10m-v1"
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
    # Deliberately exceed the browser's physical scrollbar limit. Find should
    # still place the selected full-height cell within the visible viewport.
    DashReactGrid(
        id="compressed-grid",
        columns=COLUMNS,
        data=[],
        virtualRowCount=COMPRESSED_ROWS,
        virtualDatasetId=COMPRESSED_DATASET,
        virtualRowHeight=25,
        virtualWindowSize=120,
        virtualViewportHeight=400,
    ),
    html.Div(id="compressed-requested-rows"),
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


@app.callback(
    Output("grid","virtualFindData"),
    Input("grid","virtualFindRequest"),
    prevent_initial_call=True,
)
def search_all_rows(request):
    # Search uses bounded reads from the same stateless, authoritative provider.
    def rows_for(start,end):
        return {"rowIds":[f"r{i}" for i in range(start,end)],
                "data":[[f"Row {i}", float(i)] for i in range(start,end)]}
    return find_response(
        request,dataset_id="synthetic-100k-v1",row_count=TOTAL_ROWS,
        columns=COLUMNS,fetch_rows=rows_for,chunk_size=250,
    )

@app.callback(
    Output("compressed-grid","virtualData"),
    Output("compressed-requested-rows","children"),
    Input("compressed-grid","virtualRequest"),
    prevent_initial_call=True,
)
def fetch_compressed_window(request):
    def rows_for(start,end):
        return {"rowIds":[f"cr{i}" for i in range(start,end)],
                "data":[[f"Row {i}",float(i)] for i in range(start,end)]}
    result=window_response(
        request,dataset_id=COMPRESSED_DATASET,row_count=COMPRESSED_ROWS,
        columns=COLUMNS,fetch_rows=rows_for)
    return result, f"Fetched {request['start']}:{request['end']} ({request['end']-request['start']} rows)"


@app.callback(
    Output("compressed-grid","virtualFindData"),
    Input("compressed-grid","virtualFindRequest"),
    prevent_initial_call=True,
)
def find_compressed_window(request):
    def rows_for(start,end):
        return {"rowIds":[f"cr{i}" for i in range(start,end)],
                "data":[[f"Row {i}",float(i)] for i in range(start,end)]}
    return find_response(
        request,dataset_id=COMPRESSED_DATASET,row_count=COMPRESSED_ROWS,
        columns=COLUMNS,fetch_rows=rows_for,chunk_size=250,
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1",port=PORT,debug=False)
