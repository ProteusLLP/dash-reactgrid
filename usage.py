import dash_reactgrid
from dash import Dash, callback, html, Input, Output

app = Dash(__name__)

columns = [
    {"columnId": "name", "title": "Name", "type": "text"},
    {"columnId": "surname", "title": "Surname", "type": "text"},
    {"columnId": "age", "title": "Age", "type": "number", "align": "right"},
]
data = [["Matthew", "Norman", (9)], ["James", "Norman", (44)]] + [
    ["James", "Norman", 1234]
] * 100

highlights = [
    {"columnId": "surname", "rowId": 2, "borderColor": "green", "className": "test"}
]

app.layout = html.Div(
    [
        dash_reactgrid.DashReactGrid(
            id="input",
            columns=columns,
            data=data,
            # styleHeader = {"font-weight":100},
            style={
                "height": "50vh",
                "overflowY": "scroll",
                "fontFamily": "Arial, Helvetica, sans-serif",
            },
            stickyTopRows=1,
            highlights=highlights,
            disableVirtualScrolling=False,
            enableRowSelection=True,
            enableColumnSelection=True,
            isExtendable=True,
            persistence=True,
        ),
        html.Div(id="output"),
        html.Div(id="output2"),
    ]
)


def isempty(cell):
    return True if cell is None or cell == "" or cell == float("nan") else False


# @callback(Output("input", "data"), Input("input", "data"))
def new_row(data):
    if not isempty(data[-1][0]):
        data.append([None] * len(columns))
    else:
        while len(data) > 1 and isempty(data[-2][0]):
            data.pop()

    return data


if __name__ == "__main__":
    app.run_server(debug=True, port=8080)
