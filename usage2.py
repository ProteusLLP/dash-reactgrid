import dash_reactgrid as drg
from dash import Dash, callback, html, Input, Output, State, dcc

app = Dash(__name__)

target_terms = [i for i in range(10)]
def create_columns(terms):
    columns = [{"columnId":"time","title":"Time","align":"left","type":"number"}]+[{"columnId":str(term),"title":str(term)+ " Year Rate","align":"right","type":"percent","formatOptions":{"maximumFractionDigits":3},"headerStyle":{"writingMode":"vertical-rl"}} for term in terms]
    return columns

columns = create_columns(target_terms)
data = [[3]*(len(target_terms)+1)]*10

highlights = [{"columnId":1,"rowId":2,"borderColor":"red","className":"topleft"},{"columnId":2,"rowId":2,"className":"topright"},{"columnId":1,"rowId":3,"className":"bottomleft"},{"columnId":2,"rowId":3,"className":"bottomright"}]


app.layout = html.Div([
    dcc.Input(id="terms",value=3),
    html.Div(id="grid-container",children=drg.DashReactGrid(
        id='input',
        columns=columns,
        data = data,
        enableFillHandle=True,
        highlights=highlights,
        styleHeader = {"font-weight":100,"height":100},
        style = {"height":"50vh","overflowY":"scroll",
                 "font-family": "Arial, Helvetica, sans-serif"},   
                ),
                style={"display":"none"}),
        
    html.Div(id='output'),html.Div(id='output2'),html.Button("Hide/Unhide",id="hide"),
])



#@callback(Output('input', 'data'), Input('input', 'data'))
#def new_row(data):
#    if not isempty(data[-1][0]):
#        data.append([None]*len(columns))
#    else:
#        while(len(data)>1 and isempty(data[-2][0])):
#            data.pop()

    #return data


#@app.callback(Output("input","columns"),Input("terms","value"))
#def update_columns(terms):
#    terms = int(terms)
#    terms_list = [term for term in range(1,terms+1)]
#    return create_columns(terms_list)

@app.callback(Output("grid-container","style"),Input("hide","n_clicks"),State("grid-container","style"))
def toggle_hide(n_clicks,style):
    if not n_clicks:
        return style
    if style["display"]=="none":
        return {"display":"block"}
    return {"display":"none"}

#@app.callback(Output("input","columns"),Input("hide","n_clicks"),State("input","columns"))
#def toggle_hide(n,columns):
#    return columns


flask_app = app.server

flask_app.run(debug=True, port=5000)
