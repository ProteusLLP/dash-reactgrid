import dash_reactgrid
from dash import Dash, callback, html, Input, Output, dcc

app = Dash(__name__)

target_terms = [1, 5, 20]
def create_columns(terms):
    columns = [{"columnId":"time","title":"Time","align":"left","type":"number"}]+[{"columnId":str(term),"title":str(term)+ " Year Rate","align":"right","type":"percent","formatOptions":{"maximumFractionDigits":3}} for term in terms]
    return columns

columns = create_columns(target_terms)
data = [[None]*(len(target_terms)+1)]*10


app.layout = html.Div([
    dcc.Input(id="terms",value=3),
    dash_reactgrid.DashReactGrid(
        id='input',
        columns=columns,
        data = data,
        styleHeader = {"font-weight":100},
        style = {"height":"50vh","overflowY":"scroll",
                 "font-family": "Arial, Helvetica, sans-serif"},
        stickyTopRows=1 ,        
        isExtendable=True
                ),
        
    html.Div(id='output'),html.Div(id='output2')
])

def isempty(cell):
    return True if cell is None or cell=='' or cell==float('nan') else False

#@callback(Output('input', 'data'), Input('input', 'data'))
#def new_row(data):
#    if not isempty(data[-1][0]):
#        data.append([None]*len(columns))
#    else:
#        while(len(data)>1 and isempty(data[-2][0])):
#            data.pop()

    #return data


@app.callback(Output("input","columns"),Input("terms","value"))
def update_columns(terms):
    terms = int(terms)
    terms_list = [term for term in range(1,terms+1)]
    return create_columns(terms_list)

if __name__ == '__main__':
    app.run_server(debug=True)
