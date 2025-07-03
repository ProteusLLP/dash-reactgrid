import json
import time
import pytest
from dash import Dash, html, Output, Input
import dash.testing.wait as wait
import dash_reactgrid  # replace with actual import
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains

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

path = f"#{GRID_ID} > div > div > div.rg-pane.rg-pane-center-middle > div"


@pytest.fixture
def app():
    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID, data=INITIAL_DATA, columns=COLUMNS
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def show_data(data):
        return json.dumps(data)

    return app


def test_render_grid(dash_duo, app):
    dash_duo.start_server(app)
    time.sleep(0.5)  # Allow time for the grid to render
    grid = dash_duo.find_element(f"#{GRID_ID}")
    assert grid is not None
    text = dash_duo.find_element(
        f"{path}[data-cell-colIdx='0'][data-cell-rowIdx='1']",
    )
    assert "hello" in text.text


def test_edit_text_cell(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='0'][data-cell-rowIdx='1']")
    cell.click()
    actions = ActionChains(dash_duo.driver)
    actions.send_keys("world")
    actions.send_keys("\ue007")
    actions.perform()  # Enter
    time.sleep(0.5)
    assert "world" in dash_duo.find_element("div.reactgrid").text
    assert "world" in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_edit_checkbox(dash_duo, app):
    dash_duo.start_server(app)
    checkbox = dash_duo.find_element(
        f"{path}[data-cell-colIdx='2'][data-cell-rowIdx='1']"
    )
    checkbox.click()
    time.sleep(0.5)
    # assert "false" in dash_duo.find_element("div.reactgrid").text
    assert "false" in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_edit_dropdown(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='4'][data-cell-rowIdx='1']")
    cell.click()
    cell.find_element(By.CSS_SELECTOR, "input").send_keys("B")
    cell.find_element(By.CSS_SELECTOR, "input").send_keys("\ue007")
    time.sleep(0.5)
    assert '"B"' in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_edit_number(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='1'][data-cell-rowIdx='1']")
    cell.click()
    dash_duo.find_element("body").send_keys("4")
    dash_duo.find_element("body").send_keys("\ue007")
    time.sleep(0.5)
    assert ", 4," in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_edit_date(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='3'][data-cell-rowIdx='1']")
    cell.click()
    time.sleep(0.05)
    cell.click()
    time.sleep(0.5)
    grid = dash_duo.find_element(f"#{GRID_ID}")
    grid.find_element(By.CSS_SELECTOR, 'input[type="date"]').send_keys("01.31.2024")
    grid.find_element(By.CSS_SELECTOR, 'input[type="date"]').send_keys(
        "\ue007"
    )  # Enter
    time.sleep(0.1)  # Allow time for the date to update
    assert '"2024-01-31"' in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_edit_date2(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='3'][data-cell-rowIdx='1']")
    cell.click()
    time.sleep(0.05)
    cell.click()
    time.sleep(0.5)
    grid = dash_duo.find_element(f"#{GRID_ID}")
    grid.find_element(By.CSS_SELECTOR, 'input[type="date"]').send_keys("08.30.2025")
    grid.find_element(By.CSS_SELECTOR, 'input[type="date"]').send_keys(
        "\ue007"
    )  # Enter
    time.sleep(0.1)  # Allow time for the date to update
    assert '"2025-08-30"' in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_copy_paste(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element(f"{path}[data-cell-colIdx='0'][data-cell-rowIdx='1']")
    cell.click()

    # Simulate a paste (limited by browser clipboard APIs)
    dash_duo.driver.execute_script(
        r"""
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', 'paste test');
        const e = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true
        });
        document.activeElement.dispatchEvent(e);
    """
    )
    time.sleep(0.5)
    assert "paste test" in dash_duo.find_element("div.reactgrid").text


def test_undo_redo_simulated(dash_duo, app):
    dash_duo.start_server(app)
    cell = dash_duo.find_element("div.reactgrid").find_element_by_xpath(
        "//div[text()='hello']"
    )
    cell.click()
    dash_duo.find_element("body").send_keys(" undo")
    dash_duo.find_element("body").send_keys("\ue007")

    dash_duo.find_element("body").send_keys("\ue009z")  # Ctrl+Z
    time.sleep(0.5)
    assert "hello undo" not in dash_duo.find_element(f"#{OUTPUT_ID}").text


def test_null_and_nan_cells(dash_duo, app):
    app.layout.children[0].data = [["", float("nan"), False, "", ""]]
    dash_duo.start_server(app)
    time.sleep(1)
    assert "NaN" not in dash_duo.find_element("div.reactgrid").text


def test_no_console_errors(dash_duo, app):
    dash_duo.start_server(app)
    logs = dash_duo.get_logs()
    assert all("error" not in log["message"].lower() for log in logs)
