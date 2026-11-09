"""Dedicated Chrome fixture for editing ranges above 20,000 in memory.

A bounded ReactGrid page avoids mounting the entire logical row matrix.
"""
import json
import os
from dash import Dash, Input, Output, html
from dash_reactgrid import DashReactGrid

COUNT = 22050
PORT = int(os.environ.get("GRID_LARGE_MEMORY_PORT", "8071"))
DATA = [[f"Row {i}", i] for i in range(COUNT)]
COLUMNS = [
    {"columnId": "label", "title": "Label", "type": "text", "width": 180},
    {"columnId": "number", "title": "Number", "type": "number", "width": 120},
]
app = Dash(__name__)
app.layout = html.Div([
    DashReactGrid(
        id="large-grid", columns=COLUMNS, data=DATA,
        rowIds=[f"r{i}" for i in range(COUNT)],
        rowPageSize=40, persisted_props=[],
    ),
    html.Pre(id="large-summary"),
])

@app.callback(Output("large-summary", "children"),
              Input("large-grid", "data"))
def summarise(data):
    return json.dumps({
        "count": len(data), "first": data[0],
        "middle": data[21000], "last": data[-1],
    })

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
