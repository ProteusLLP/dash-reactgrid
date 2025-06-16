import dash_reactgrid
from dash import Dash, callback, html, Input, Output
import json

app = Dash(__name__)

GRID_ID = "grid"
OUTPUT_ID = "output"

COLUMNS = [
    {"columnId": "col1", "title": "Text", "type": "text"},
    {"columnId": "col2", "title": "Number", "type": "number"},
    {"columnId": "col3", "title": "Checkbox", "type": "checkbox"},
    {"columnId": "col4", "title": "Date", "type": "date"},
    {
        "columnId": "col5",
        "title": "Dropdown",
        "type": "dropdown",
        "values": [
            {"value": "A", "label": "Apple"},
            {"value": "B", "label": "Banana"},
            {"value": "C", "label": "Cherry"},
        ],
    },
]

INITIAL_DATA = [["hello", 123, True, "2024-01-01", "A"]]


app = Dash(__name__)
app.layout = html.Div(
    [
        dash_reactgrid.DashReactGrid(id=GRID_ID, data=INITIAL_DATA, columns=COLUMNS),
        html.Div(id=OUTPUT_ID),
    ]
)


@app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
def show_data(data):
    return json.dumps(data)


if __name__ == "__main__":
    app.run_server(debug=True, port=8080)
