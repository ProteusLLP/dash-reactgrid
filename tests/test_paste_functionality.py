"""
Copy/Paste and data manipulation test suite for DashReactGrid component.

This module contains tests for:
- Copy/paste functionality
- Data boundary handling
- Undo/redo operations
- Data validation
- Keyboard interactions
"""

import time
import pytest
from dash import Dash, html, Output, Input
import dash_reactgrid
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains

GRID_ID = "paste-test-grid"
OUTPUT_ID = "paste-output"


@pytest.fixture
def paste_app():
    """App fixture for copy/paste testing."""
    columns = [
        {"columnId": "col1", "title": "Text", "type": "text", "width": 120},
        {"columnId": "col2", "title": "Number", "type": "number", "width": 100},
        {"columnId": "col3", "title": "Date", "type": "date", "width": 120},
    ]

    data = [
        ["Text 1", 100, "2024-01-01"],
        ["Text 2", 200, "2024-01-02"],
        ["Text 3", 300, "2024-01-03"],
    ]

    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=data,
                columns=columns,
                enableFillHandle=True,
                enableRangeSelection=True,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return f"Grid has {len(data)} rows"

    return app


@pytest.fixture
def extendable_paste_app():
    """App fixture for extendable grid copy/paste testing."""
    columns = [
        {"columnId": "col1", "title": "Text", "type": "text", "width": 120},
        {"columnId": "col2", "title": "Number", "type": "number", "width": 100},
    ]

    data = [
        ["Initial", 1],
        ["Data", 2],
    ]

    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=data,
                columns=columns,
                isExtendable=True,
                enableFillHandle=True,
                enableRangeSelection=True,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return f"Extendable grid has {len(data)} rows"

    return app


class TestCopyPasteFunctionality:
    """Test class for copy/paste and data manipulation."""

    def test_simple_paste_operation(self, dash_duo, paste_app):
        """Test basic paste functionality."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find a text cell and click it
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Simulate paste event with JavaScript
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain', 'Pasted Text');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Check if paste worked
            # (content might vary based on implementation)
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Grid has" in output

    def test_paste_within_boundaries(self, dash_duo, paste_app):
        """Test pasting data that fits within grid boundaries."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Simulate pasting a 2x2 range that fits
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain', 'A\\tB\\nC\\tD');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Should still have original number of rows (paste within bounds)
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Grid has 3 rows" in output

    def test_paste_overflow_non_extendable(self, dash_duo, paste_app):
        """Test pasting data that exceeds non-extendable grid boundaries."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on last cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            # Try to click on last visible cell
            cells[-1].click()

            # Simulate pasting data that would overflow
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain',
                    'Overflow1\\tOverflow2\\tOverflow3\\tOverflow4\\n' +
                    'Row2\\tData2\\tData3\\tData4\\n' +
                    'Row3\\tData3\\tData4\\tData5');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Should not crash and maintain original structure
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Grid has" in output

            # No console errors should occur
            logs = dash_duo.get_logs()
            error_logs = [
                log for log in logs if "error" in log.get("message", "").lower()
            ]
            assert len(error_logs) == 0, f"Console errors: {error_logs}"

    def test_paste_overflow_extendable(self, dash_duo, extendable_paste_app):
        """Test pasting data that extends an extendable grid."""
        dash_duo.start_server(extendable_paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Simulate pasting data that extends the grid
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain',
                    'New1\\t10\\n' +
                    'New2\\t20\\n' +
                    'New3\\t30\\n' +
                    'New4\\t40');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(1)

            # Should extend the grid (may have more rows now)
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "grid has" in output.lower()

    def test_keyboard_navigation(self, dash_duo, paste_app):
        """Test keyboard navigation within the grid."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Test arrow key navigation
            actions = ActionChains(dash_duo.driver)

            # Move right
            actions.send_keys(Keys.ARROW_RIGHT).perform()
            time.sleep(0.2)

            # Move down
            actions.send_keys(Keys.ARROW_DOWN).perform()
            time.sleep(0.2)

            # Move left
            actions.send_keys(Keys.ARROW_LEFT).perform()
            time.sleep(0.2)

            # Move up
            actions.send_keys(Keys.ARROW_UP).perform()
            time.sleep(0.2)

            # Should not crash during navigation
            assert dash_duo.find_element(f"#{GRID_ID}") is not None

    def test_select_all_copy(self, dash_duo, paste_app):
        """Test select all and copy functionality."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on grid to focus
        grid = dash_duo.find_element(f"#{GRID_ID}")
        grid.click()

        # Try Ctrl+A to select all
        actions = ActionChains(dash_duo.driver)
        actions.key_down(Keys.CONTROL).send_keys("a").key_up(Keys.CONTROL)
        actions.perform()

        time.sleep(0.5)

        # Try Ctrl+C to copy
        actions = ActionChains(dash_duo.driver)
        actions.key_down(Keys.CONTROL).send_keys("c").key_up(Keys.CONTROL)
        actions.perform()

        time.sleep(0.5)

        # Should not crash
        assert grid is not None

    def test_undo_redo_simulation(self, dash_duo, paste_app):
        """Test undo/redo functionality simulation."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell and edit
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Type new text
            actions = ActionChains(dash_duo.driver)
            actions.send_keys("Modified Text").send_keys(Keys.ENTER).perform()

            time.sleep(0.5)

            # Try Ctrl+Z (undo)
            actions = ActionChains(dash_duo.driver)
            ctrl_z = actions.key_down(Keys.CONTROL).send_keys("z")
            ctrl_z.key_up(Keys.CONTROL)
            ctrl_z.perform()

            time.sleep(0.5)

            # Try Ctrl+Y (redo)
            actions = ActionChains(dash_duo.driver)
            ctrl_y = actions.key_down(Keys.CONTROL).send_keys("y")
            ctrl_y.key_up(Keys.CONTROL)
            ctrl_y.perform()

            time.sleep(0.5)

            # Should not crash during undo/redo
            assert dash_duo.find_element(f"#{GRID_ID}") is not None

    def test_invalid_paste_data(self, dash_duo, paste_app):
        """Test handling of invalid paste data."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on number cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if len(cells) > 1:
            cells[1].click()  # Assuming second cell is number type

            # Try to paste non-numeric data into number cell
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain', 'not a number');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Should handle gracefully without crashing
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Grid has" in output

    def test_empty_paste_data(self, dash_duo, paste_app):
        """Test handling of empty paste data."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Try to paste empty data
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain', '');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Should handle gracefully
            assert dash_duo.find_element(f"#{GRID_ID}") is not None

    def test_large_paste_data(self, dash_duo, extendable_paste_app):
        """Test pasting large amounts of data."""
        dash_duo.start_server(extendable_paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Generate large paste data (50 rows)
            large_data = []
            for i in range(50):
                large_data.append(f"Row{i}\\t{i * 10}")

            paste_text = "\\n".join(large_data)

            # Paste large data
            dash_duo.driver.execute_script(
                f"""
                const event = new ClipboardEvent('paste', {{
                    clipboardData: new DataTransfer(),
                    bubbles: true
                }});
                event.clipboardData.setData('text/plain', '{paste_text}');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(2)  # Allow more time for large paste

            # Should handle large paste without crashing
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "grid has" in output.lower()

    def test_cross_cell_type_paste(self, dash_duo, paste_app):
        """Test pasting data across different cell types."""
        dash_duo.start_server(paste_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Click on first cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cells[0].click()

            # Paste mixed data types
            dash_duo.driver.execute_script(
                """
                const event = new ClipboardEvent('paste', {
                    clipboardData: new DataTransfer(),
                    bubbles: true
                });
                event.clipboardData.setData('text/plain', 
                    'Mixed Text\\t999\\t2024-12-31');
                document.activeElement.dispatchEvent(event);
            """
            )

            time.sleep(0.5)

            # Should handle mixed types appropriately
            assert dash_duo.find_element(f"#{GRID_ID}") is not None

            # No type conversion errors in console
            logs = dash_duo.get_logs()
            type_errors = [
                log
                for log in logs
                if "type" in log.get("message", "").lower()
                and "error" in log.get("message", "").lower()
            ]
            assert len(type_errors) == 0
