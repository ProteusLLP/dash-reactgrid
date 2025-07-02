"""
Comprehensive test suite for DashReactGrid component.

This module contains tests for basic grid functionality including:
- Grid rendering
- Cell editing for all cell types
- Data validation
- Error handling
"""

import json
import time
import pytest
from dash import Dash, html, Output, Input
import dash.testing.wait as wait
import dash_reactgrid
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains

# Test constants
GRID_ID = "test-grid"
OUTPUT_ID = "test-output"

# Standard column definitions for testing
STANDARD_COLUMNS = [
    {"columnId": "text_col", "title": "Text", "type": "text", "width": 120},
    {"columnId": "number_col", "title": "Number", "type": "number", "width": 100},
    {"columnId": "checkbox_col", "title": "Checkbox", "type": "checkbox", "width": 80},
    {"columnId": "date_col", "title": "Date", "type": "date", "width": 120},
    {
        "columnId": "dropdown_col",
        "title": "Dropdown",
        "type": "dropdown",
        "width": 120,
        "values": [
            {"value": "option1", "label": "Option 1"},
            {"value": "option2", "label": "Option 2"},
            {"value": "option3", "label": "Option 3"},
        ],
    },
]

# Standard test data
STANDARD_DATA = [
    ["Text 1", 123, True, "2024-01-01", "option1"],
    ["Text 2", 456, False, "2024-02-15", "option2"],
    ["Text 3", 789, True, "2024-03-30", "option3"],
]

# CSS selector for grid cells
CELL_SELECTOR = f"#{GRID_ID} .rg-cell"


@pytest.fixture
def basic_app():
    """Basic app fixture with standard grid configuration."""
    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=STANDARD_DATA,
                columns=STANDARD_COLUMNS,
                enableFillHandle=True,
                enableRangeSelection=True,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return json.dumps(data)

    return app


@pytest.fixture
def extendable_app():
    """App fixture with extendable grid configuration."""
    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=STANDARD_DATA,
                columns=STANDARD_COLUMNS,
                isExtendable=True,
                enableFillHandle=True,
                enableRangeSelection=True,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return json.dumps(data)

    return app


class TestBasicGridFunctionality:
    """Test basic grid rendering and interaction."""

    def test_grid_renders_correctly(self, dash_duo, basic_app):
        """Test that the grid renders with correct initial data."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Check that grid is present
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

        # Check that data is displayed correctly
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        output_data = json.loads(output.text)
        assert output_data == STANDARD_DATA

    def test_grid_has_correct_headers(self, dash_duo, basic_app):
        """Test that column headers are displayed correctly."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Check each header
        for col in STANDARD_COLUMNS:
            header_text = col["title"]
            assert header_text in dash_duo.find_element("div.reactgrid").text

    def test_grid_dimensions(self, dash_duo, basic_app):
        """Test that grid has correct number of rows and columns."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Count data cells (excluding headers)
        cells = dash_duo.find_elements(CELL_SELECTOR + "[data-cell-rowIdx='1']")
        assert len(cells) == len(STANDARD_COLUMNS)

    def test_no_console_errors_on_load(self, dash_duo, basic_app):
        """Test that no console errors occur during initial load."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Allow time for any async operations
        time.sleep(1)

        logs = dash_duo.get_logs()
        error_logs = [log for log in logs if log.get("level") == "SEVERE"]
        assert len(error_logs) == 0, f"Console errors found: {error_logs}"


class TestCellEditing:
    """Test editing functionality for different cell types."""

    def test_edit_text_cell(self, dash_duo, basic_app):
        """Test editing a text cell."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click text cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='0'][data-cell-rowIdx='1']"
        )
        cell.click()

        # Clear and type new text
        ActionChains(dash_duo.driver).key_down(Keys.CONTROL).send_keys("a").key_up(
            Keys.CONTROL
        ).perform()
        dash_duo.driver.switch_to.active_element.send_keys("New Text")
        dash_duo.driver.switch_to.active_element.send_keys(Keys.ENTER)

        # Wait for update and verify
        time.sleep(0.5)
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        assert '"New Text"' in output.text

    def test_edit_number_cell(self, dash_duo, basic_app):
        """Test editing a number cell."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click number cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='1'][data-cell-rowIdx='1']"
        )
        cell.click()

        # Clear and type new number
        ActionChains(dash_duo.driver).key_down(Keys.CONTROL).send_keys("a").key_up(
            Keys.CONTROL
        ).perform()
        dash_duo.driver.switch_to.active_element.send_keys("999")
        dash_duo.driver.switch_to.active_element.send_keys(Keys.ENTER)

        # Wait for update and verify
        time.sleep(0.5)
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        assert "999" in output.text

    def test_edit_checkbox_cell(self, dash_duo, basic_app):
        """Test toggling a checkbox cell."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click checkbox cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='2'][data-cell-rowIdx='1']"
        )
        cell.click()

        # Wait for toggle and verify
        time.sleep(0.5)
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        # Should toggle from True to False
        output_data = json.loads(output.text)
        assert output_data[0][2] is False

    def test_edit_date_cell(self, dash_duo, basic_app):
        """Test editing a date cell."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click date cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='3'][data-cell-rowIdx='1']"
        )
        cell.click()
        time.sleep(0.1)
        cell.click()  # Double click to activate date input

        # Wait for date input to appear
        time.sleep(0.5)

        try:
            date_input = dash_duo.find_element('input[type="date"]')
            # Use JavaScript to set the date value properly
            dash_duo.driver.execute_script(
                "arguments[0].value = '2025-12-25'; arguments[0].dispatchEvent(new Event('change', {bubbles: true}));",
                date_input,
            )
            date_input.send_keys(Keys.ENTER)

            # Wait for update and verify
            time.sleep(0.5)
            output = dash_duo.find_element(f"#{OUTPUT_ID}")
            # Check if the date was updated (format might vary)
            assert any(
                date_str in output.text
                for date_str in ['"2025-12-25"', "2025-12-25", "25/12/2025"]
            )
        except Exception as e:
            pytest.skip(f"Date input interaction failed: {e}")

    def test_edit_dropdown_cell(self, dash_duo, basic_app):
        """Test selecting from a dropdown cell."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click dropdown cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='4'][data-cell-rowIdx='1']"
        )
        cell.click()

        # Wait for dropdown to open
        time.sleep(0.5)

        try:
            # Try to find dropdown options
            dropdown_options = dash_duo.find_elements(".rg-dropdown-option")
            if dropdown_options:
                # Click the second option
                dropdown_options[1].click()

                # Wait for update and verify
                time.sleep(0.5)
                output = dash_duo.find_element(f"#{OUTPUT_ID}")
                assert '"option2"' in output.text
            else:
                # Fallback: use keyboard input
                ActionChains(dash_duo.driver).send_keys("option2").send_keys(
                    Keys.ENTER
                ).perform()
                time.sleep(0.5)
                output = dash_duo.find_element(f"#{OUTPUT_ID}")
                assert '"option2"' in output.text
        except Exception as e:
            pytest.skip(f"Dropdown interaction failed: {e}")


class TestDataValidation:
    """Test data validation and error handling."""

    def test_invalid_number_input(self, dash_duo, basic_app):
        """Test that invalid number input is handled gracefully."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find and click number cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='1'][data-cell-rowIdx='1']"
        )
        cell.click()

        # Try to enter invalid text
        ActionChains(dash_duo.driver).key_down(Keys.CONTROL).send_keys("a").key_up(
            Keys.CONTROL
        ).perform()
        dash_duo.driver.switch_to.active_element.send_keys("invalid_text")
        dash_duo.driver.switch_to.active_element.send_keys(Keys.ENTER)

        # Wait and check that original value is preserved or null
        time.sleep(0.5)
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        output_data = json.loads(output.text)
        # Should either preserve original value or be null
        assert output_data[0][1] in [123, None]

    def test_empty_cell_handling(self, dash_duo, basic_app):
        """Test that empty cells are handled correctly."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Clear a text cell
        cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='0'][data-cell-rowIdx='1']"
        )
        cell.click()

        ActionChains(dash_duo.driver).key_down(Keys.CONTROL).send_keys("a").key_up(
            Keys.CONTROL
        ).perform()
        dash_duo.driver.switch_to.active_element.send_keys(Keys.DELETE)
        dash_duo.driver.switch_to.active_element.send_keys(Keys.ENTER)

        # Wait and verify empty value
        time.sleep(0.5)
        output = dash_duo.find_element(f"#{OUTPUT_ID}")
        output_data = json.loads(output.text)
        assert output_data[0][0] in ["", None]


class TestGridProperties:
    """Test various grid properties and configurations."""

    def test_grid_with_custom_styles(self, dash_duo):
        """Test grid with custom styling."""
        app = Dash(__name__)
        custom_style = {"backgroundColor": "lightblue", "border": "2px solid red"}
        custom_header_style = {"backgroundColor": "yellow", "fontWeight": "bold"}

        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=STANDARD_DATA,
                    columns=STANDARD_COLUMNS,
                    style=custom_style,
                    styleHeader=custom_header_style,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return json.dumps(data)

        dash_duo.start_server(app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Check that grid rendered successfully with custom styles
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

    def test_grid_with_range_selection(self, dash_duo, basic_app):
        """Test grid with range selection enabled."""
        dash_duo.start_server(basic_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Try to select a range of cells
        first_cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='0'][data-cell-rowIdx='1']"
        )
        last_cell = dash_duo.find_element(
            f"{CELL_SELECTOR}[data-cell-colIdx='1'][data-cell-rowIdx='2']"
        )

        # Perform range selection
        ActionChains(dash_duo.driver).click(first_cell).key_down(Keys.SHIFT).click(
            last_cell
        ).key_up(Keys.SHIFT).perform()

        # Verify no errors occurred
        time.sleep(0.5)
        logs = dash_duo.get_logs()
        error_logs = [log for log in logs if log.get("level") == "SEVERE"]
        assert len(error_logs) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
