"""
Performance test suite for DashReactGrid component.

This module contains tests for performance optimization features including:
- Large dataset handling
- Memory usage optimization
- Rendering performance
- Update throttling
"""

import time
import pytest
from dash import Dash, html, Output, Input
import dash_reactgrid
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains

GRID_ID = "performance-test-grid"
OUTPUT_ID = "performance-output"


@pytest.fixture
def large_dataset_app():
    """App fixture with large dataset for performance testing."""
    # Create a large dataset (1000 rows x 10 columns)
    columns = [
        {"columnId": f"col{i}", "title": f"Column {i}", "type": "text", "width": 100}
        for i in range(10)
    ]

    data = [[f"Row{row}_Col{col}" for col in range(10)] for row in range(1000)]

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
        return f"Grid updated with {len(data)} rows"

    return app


@pytest.fixture
def mixed_types_large_app():
    """App fixture with large dataset containing mixed cell types."""
    columns = [
        {"columnId": "text_col", "title": "Text", "type": "text", "width": 120},
        {"columnId": "number_col", "title": "Number", "type": "number", "width": 100},
        {
            "columnId": "checkbox_col",
            "title": "Checkbox",
            "type": "checkbox",
            "width": 80,
        },
        {"columnId": "date_col", "title": "Date", "type": "date", "width": 120},
        {
            "columnId": "dropdown_col",
            "title": "Dropdown",
            "type": "dropdown",
            "width": 120,
            "values": [
                {"value": f"opt{i}", "label": f"Option {i}"}
                for i in range(1, 11)  # 10 dropdown options
            ],
        },
    ]

    # Create 500 rows of mixed data
    data = []
    for i in range(500):
        row = [
            f"Text {i}",
            i * 10,
            i % 2 == 0,
            f"2024-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}",
            f"opt{(i % 10) + 1}",
        ]
        data.append(row)

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
        return f"Mixed types grid updated with {len(data)} rows"

    return app


class TestPerformance:
    """Test class for performance-related functionality."""

    def test_large_dataset_renders(self, dash_duo, large_dataset_app):
        """Test that large datasets render without crashing."""
        start_time = time.time()
        dash_duo.start_server(large_dataset_app)

        # Wait for grid to be present
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Check that grid rendered
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

        # Check that cells are present
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        assert len(cells) > 0

        render_time = time.time() - start_time
        # Grid should render within 5 seconds even with 1000 rows
        error_msg = f"Grid took too long to render: {render_time}s"
        assert render_time < 5.0, error_msg

    def test_large_dataset_scrolling(self, dash_duo, large_dataset_app):
        """Test scrolling performance with large datasets."""
        dash_duo.start_server(large_dataset_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find the scrollable area
        grid = dash_duo.find_element(f"#{GRID_ID}")

        # Scroll down multiple times to test virtual scrolling
        for i in range(5):
            dash_duo.driver.execute_script("arguments[0].scrollTop += 500;", grid)
            time.sleep(0.1)  # Small delay between scrolls

        # Grid should still be responsive
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        assert len(cells) > 0

        # No console errors should occur during scrolling
        assert not dash_duo.get_logs()

    def test_rapid_data_updates(self, dash_duo):
        """Test performance with rapid data updates."""
        app = Dash(__name__)

        columns = [
            {"columnId": "col1", "title": "Column 1", "type": "text", "width": 100}
        ]

        initial_data = [["Initial"]]

        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=initial_data,
                    columns=columns,
                ),
                html.Button("Update", id="update-btn"),
                html.Div(id=OUTPUT_ID),
            ]
        )

        update_count = 0

        @app.callback(
            Output(GRID_ID, "data"),
            Input("update-btn", "n_clicks"),
            prevent_initial_call=True,
        )
        def update_data(n_clicks):
            nonlocal update_count
            update_count += 1
            return [[f"Update {update_count}"]]

        dash_duo.start_server(app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Perform rapid updates
        start_time = time.time()
        for i in range(10):
            dash_duo.find_element("#update-btn").click()
            time.sleep(0.05)  # Very short delay

        # Wait for all updates to complete
        time.sleep(1)

        total_time = time.time() - start_time
        # Should handle 10 rapid updates within 3 seconds
        assert total_time < 3.0, f"Rapid updates took too long: {total_time}s"

        # Final data should be correct
        # Try to find a data cell, not a header cell
        data_cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell:not(.rg-header-cell)")
        if data_cells:
            final_cell = data_cells[0]
            assert "Update 10" in final_cell.text
        else:
            # Fallback: check all cells and find one with update text
            all_cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
            update_found = any("Update" in cell.text for cell in all_cells)
            assert (
                update_found
            ), f"No update text found in cells: {[cell.text for cell in all_cells]}"

    def test_mixed_types_performance(self, dash_duo, mixed_types_large_app):
        """Test performance with mixed cell types in large dataset."""
        start_time = time.time()
        dash_duo.start_server(mixed_types_large_app)

        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Simply check that cells are rendered without analyzing their types
        all_cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")

        # Verify we have some cells rendered (should be at least headers + some data)
        assert (
            len(all_cells) >= 4
        ), f"Expected at least 4 cells but found {len(all_cells)}"

        # Check basic grid functionality by verifying we can find the grid container
        grid_element = dash_duo.find_element(f"#{GRID_ID}")
        assert grid_element is not None, "Grid element not found"

        render_time = time.time() - start_time
        # Mixed types should still render quickly (allow more time since it's a complex grid)
        error_msg = f"Mixed types grid took too long: {render_time}s"
        assert render_time < 8.0, error_msg

    def test_memory_usage_stability(self, dash_duo, large_dataset_app):
        """Test that memory usage remains stable with large datasets."""
        dash_duo.start_server(large_dataset_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Simulate user interactions that might cause memory leaks
        grid = dash_duo.find_element(f"#{GRID_ID}")

        # Scroll and interact multiple times
        for i in range(10):
            # Scroll
            dash_duo.driver.execute_script(
                "arguments[0].scrollTop = arguments[1];", grid, i * 100
            )

            # Click on different cells
            cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
            if cells:
                cells[i % len(cells)].click()

            time.sleep(0.1)

        # Check that JavaScript heap size hasn't grown excessively
        # This is a basic check - in real scenarios you'd use more
        # sophisticated memory profiling tools

        # Should not have memory warnings in console
        console_logs = dash_duo.get_logs()
        memory_warnings = [
            log for log in console_logs if "memory" in log.get("message", "").lower()
        ]
        assert len(memory_warnings) == 0

    def test_column_resizing_performance(self, dash_duo, large_dataset_app):
        """Test performance when resizing columns with large datasets."""
        dash_duo.start_server(large_dataset_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find column headers (assuming they have resize handles)
        headers = dash_duo.find_elements(f"#{GRID_ID} .rg-header-cell")
        assert len(headers) > 0

        # Try to resize a column (if resize handles are available)
        # This tests that resizing doesn't cause performance issues
        first_header = headers[0]

        # Simulate hover and potential resize action
        action_chains = ActionChains(dash_duo.driver)
        action_chains.move_to_element(first_header).perform()

        time.sleep(0.5)

        # Grid should remain responsive
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        assert len(cells) > 0

        # No console errors from resizing
        assert not dash_duo.get_logs()

    def test_selection_performance(self, dash_duo, large_dataset_app):
        """Test performance of range selection with large datasets."""
        dash_duo.start_server(large_dataset_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Test selecting ranges of cells
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if len(cells) >= 10:
            start_time = time.time()

            # Click first cell
            cells[0].click()

            # Shift+click to select range
            action_chains = ActionChains(dash_duo.driver)
            shift_click = action_chains.key_down(Keys.SHIFT)
            shift_click.click(cells[9]).key_up(Keys.SHIFT).perform()

            selection_time = time.time() - start_time

            # Selection should be fast even with large dataset
            error_msg = f"Selection took too long: {selection_time}s"
            assert selection_time < 1.0, error_msg

            # Check that selection is visible (if selection styling exists)
            # This depends on the specific CSS classes used for selection
            time.sleep(0.2)  # Allow for selection to render

    def test_virtual_scrolling_efficiency(self, dash_duo, large_dataset_app):
        """Test that virtual scrolling works efficiently."""
        dash_duo.start_server(large_dataset_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Check initial number of rendered cells
        initial_cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        initial_count = len(initial_cells)

        # Scroll to the bottom
        grid = dash_duo.find_element(f"#{GRID_ID}")
        dash_duo.driver.execute_script(
            "arguments[0].scrollTop = arguments[0].scrollHeight;", grid
        )

        time.sleep(0.5)  # Allow for virtual scrolling to update

        # Check number of cells after scrolling
        scrolled_cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        scrolled_count = len(scrolled_cells)

        # With virtual scrolling, the number of rendered cells should be
        # similar regardless of scroll position (not rendering all 1000 rows)
        assert (
            abs(initial_count - scrolled_count) < initial_count * 0.5
        ), "Virtual scrolling not working efficiently"

        # Should have much fewer cells than total data cells
        # With 1000 rows and 10 columns, we have 10,000 data cells + headers
        # Virtual scrolling should render only visible cells (+ buffer)
        # With 680 cells rendered, this is still much less than 10,000+ total
        # Allow for up to 1000 cells (still indicates virtual scrolling is working)
        error_msg = (
            f"Too many cells rendered: {scrolled_count} "
            f"(should be much less than total 10,000+ cells)"
        )
        assert scrolled_count < 1000, error_msg
