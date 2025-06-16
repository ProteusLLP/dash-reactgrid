from dash.testing.application_runners import import_app
import time
import pytest


# Basic test for the component rendering.
# The dash_duo pytest fixture is installed with dash (v1.0+)
def test_render_component(dash_duo):
    # Start a dash app contained as the variable `app` in `usage.py`
    app = import_app("usage")
    dash_duo.start_server(app)

    # Get the generated component input with selenium
    # The html input will be a children of the #input dash component
    first_cell = "#grid > div > div > div.rg-pane.rg-pane-center-middle > div[data-cell-colIdx='0'][data-cell-rowIdx='1']"
    my_component = dash_duo.find_element(first_cell)

    assert "hello" == my_component.text
    # Clear the input
    # dash_duo.clear_input(my_component)

    # Send keys to the custom input.
    my_component.click()
    dash_duo.find_element("body").send_keys("Hello dash")
    dash_duo.find_element("body").send_keys("\ue007")  # Enter

    time.sleep(0.5)  # Allow some time for the input to update

    my_component = dash_duo.find_element(first_cell)
    assert "Hello dash" == my_component.text
