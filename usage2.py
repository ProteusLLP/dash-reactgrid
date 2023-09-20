import dash_reactgrid
from dash import Dash, callback, html, Input, Output

app = Dash(__name__)

target_terms = [1, 5, 20]

columns = [{"columnId":"time","title": "Time","type":"number","align":"left"}]+[{"columnId":"term"+str(term),"title": str(term)+" Year Rate","type":"percent","align":"right"} for term in target_terms]
data = [[None]*(len(target_terms)+1)]


app.layout = html.Div([
    dash_reactgrid.DashReactGrid(
        id='input',
        columns=columns,
        data = data,
        styleHeader = {"font-weight":100},
        style = {"height":"50vh","overflowY":"scroll",
                 "font-family": "Arial, Helvetica, sans-serif"},
        stickyTopRows=1         
                ),
        
    html.Div(id='output'),html.Div(id='output2')
])

def isempty(cell):
    return True if cell is None or cell=='' or cell==float('nan') else False

@callback(Output('input', 'data'), Input('input', 'data'))
def new_row(data):
    if not isempty(data[-1][0]):
        data.append([None]*len(columns))
    else:
        while(len(data)>1 and isempty(data[-2][0])):
            data.pop()

    return data


if __name__ == '__main__':
    app.run_server(debug=False)
