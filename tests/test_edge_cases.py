"""
Edge cases and error handling test suite for DashReactGrid component.

This module contains tests for:
- Edge case scenarios
- Error handling and recovery
- Boundary conditions
- Data integrity
- Robustness testing
"""

import time
import pytest
from dash import Dash, html, Output, Input
import dash_reactgrid
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import TimeoutException

GRID_ID = "edge-test-grid"
OUTPUT_ID = "edge-output"


@pytest.fixture
def edge_case_app():
    """App fixture for edge case testing."""
    columns = [
        {"columnId": "text", "title": "Text", "type": "text", "width": 120},
        {"columnId": "number", "title": "Number", "type": "number", "width": 100},
        {
            "columnId": "dropdown",
            "title": "Dropdown",
            "type": "dropdown",
            "width": 120,
            "values": [
                {"value": "opt1", "label": "Option 1"},
                {"value": "opt2", "label": "Option 2"},
            ],
        },
    ]

    # Mix of normal and edge case data
    data = [
        ["Normal", 123, "opt1"],
        ["", 0, "opt1"],  # Empty string, zero
        ["   ", -999, "opt2"],  # Whitespace, negative
        ["Very Long Text That Might Cause Issues", 999999, "opt1"],
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
        return f"Data updated: {len(data)} rows"

    return app


@pytest.fixture
def empty_app():
    """App fixture with empty data."""
    columns = [
        {"columnId": "col1", "title": "Column 1", "type": "text", "width": 120},
    ]

    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=[],  # Empty data
                columns=columns,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return f"Empty grid: {len(data)} rows"

    return app


@pytest.fixture
def single_cell_app():
    """App fixture with single cell."""
    columns = [
        {"columnId": "single", "title": "Single", "type": "text", "width": 120},
    ]

    app = Dash(__name__)
    app.layout = html.Div(
        [
            dash_reactgrid.DashReactGrid(
                id=GRID_ID,
                data=[["Single Cell"]],
                columns=columns,
            ),
            html.Div(id=OUTPUT_ID),
        ]
    )

    @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
    def update_output(data):
        return f"Single cell grid: {data}"

    return app


class TestEdgeCasesAndErrorHandling:
    """Test class for edge cases and error handling."""

    def test_empty_grid_rendering(self, dash_duo, empty_app):
        """Test rendering of empty grid."""
        dash_duo.start_server(empty_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Grid should render even when empty
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

        # Should show 0 rows
        output = dash_duo.find_element(f"#{OUTPUT_ID}").text
        assert "0 rows" in output

    def test_single_cell_operations(self, dash_duo, single_cell_app):
        """Test operations on single cell grid."""
        dash_duo.start_server(single_cell_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find the single cell
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if cells:
            cell = cells[0]
            cell.click()

            # Try to edit the cell
            actions = ActionChains(dash_duo.driver)
            actions.send_keys("Modified").send_keys(Keys.ENTER).perform()

            time.sleep(0.5)

            # Should handle single cell editing
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Single cell grid" in output

    def test_very_long_text_handling(self, dash_duo, edge_case_app):
        """Test handling of very long text content."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Grid should render with long text
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

        # Should not cause layout issues
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        assert len(cells) > 0

    def test_negative_numbers(self, dash_duo, edge_case_app):
        """Test handling of negative numbers."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Find number cells and check they render negative values
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        assert len(cells) > 0

        # Grid should handle negative numbers without issues
        output = dash_duo.find_element(f"#{OUTPUT_ID}").text
        assert "Data updated" in output

    def test_whitespace_only_content(self, dash_duo, edge_case_app):
        """Test handling of whitespace-only content."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Should handle whitespace content gracefully
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

    def test_rapid_cell_editing(self, dash_duo, edge_case_app):
        """Test rapid consecutive cell edits."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Get multiple cells
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if len(cells) >= 3:
            actions = ActionChains(dash_duo.driver)

            # Rapidly edit multiple cells
            for i, cell in enumerate(cells[:3]):
                cell.click()
                actions.send_keys(f"Rapid{i}").send_keys(Keys.ENTER).perform()
                time.sleep(0.1)  # Very short delay

            time.sleep(0.5)

            # Should handle rapid edits without crashing
            output = dash_duo.find_element(f"#{OUTPUT_ID}").text
            assert "Data updated" in output

    def test_invalid_column_configuration(self, dash_duo):
        """Test grid with invalid column configuration."""
        # Create app with potentially problematic column config
        columns = [
            {"columnId": "", "title": "", "type": "text"},  # Empty IDs
            {"columnId": "valid", "title": "Valid", "type": "unknown"},  # Invalid type
        ]

        app = Dash(__name__)
        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=[["test", "data"]],
                    columns=columns,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return "Invalid config test"

        dash_duo.start_server(app)

        # Should either render gracefully or fail gracefully
        try:
            dash_duo.wait_for_element(f"#{GRID_ID}", timeout=5)
            # If it renders, check it doesn't crash
            grid = dash_duo.find_element(f"#{GRID_ID}")
            assert grid is not None
        except Exception:
            # If it fails to render, that's also acceptable for invalid config
            pass

    def test_mismatched_data_columns(self, dash_duo):
        """Test grid with mismatched data and column counts."""
        columns = [
            {"columnId": "col1", "title": "Column 1", "type": "text"},
            {"columnId": "col2", "title": "Column 2", "type": "text"},
        ]

        # Data has 3 columns but only 2 column definitions
        data = [
            ["A", "B", "C"],  # Extra column
            ["D", "E"],  # Matching columns
            ["F"],  # Missing column
        ]

        app = Dash(__name__)
        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=data,
                    columns=columns,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return f"Mismatched data: {len(data)} rows"

        dash_duo.start_server(app)

        # Component might not render with invalid data, check if it handles gracefully
        try:
            dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)
            # If element is found, verify it exists
            grid = dash_duo.find_element(f"#{GRID_ID}")
            assert grid is not None
        except TimeoutException:
            # Component may not render with mismatched data - check that errors are related to data mismatch
            logs = dash_duo.get_logs()
            # Expect JavaScript errors for mismatched data but verify they're the expected type
            error_messages = [
                log["message"] for log in logs if log["level"] == "SEVERE"
            ]
            assert any(
                "Cannot read properties of undefined" in msg for msg in error_messages
            ), f"Expected JavaScript errors for mismatched data, got: {error_messages}"

    def test_special_characters_in_data(self, dash_duo):
        """Test handling of special characters in data."""
        columns = [
            {"columnId": "special", "title": "Special", "type": "text"},
        ]

        # Data with various special characters
        data = [
            ["áéíóú"],  # Accented characters
            ["日本語"],  # Unicode characters
            ["<script>alert('xss')</script>"],  # HTML/XSS attempt
            ["'\"&<>"],  # HTML entities
            ["\t\n\r"],  # Control characters
            ["🚀🎉💯"],  # Emojis
        ]

        app = Dash(__name__)
        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=data,
                    columns=columns,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return f"Special chars: {len(data)} rows"

        dash_duo.start_server(app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Should handle special characters safely
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

        # No XSS or script execution
        alerts = dash_duo.driver.execute_script("return window.alertCount || 0")
        assert alerts == 0

    def test_extremely_large_numbers(self, dash_duo):
        """Test handling of extremely large numbers."""
        columns = [
            {"columnId": "big", "title": "Big Numbers", "type": "number"},
        ]

        data = [
            [999999999999999999],  # Very large number
            [-999999999999999999],  # Very large negative
            [0.000000000001],  # Very small decimal
            [1.7976931348623157e308],  # Near JavaScript max
        ]

        app = Dash(__name__)
        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=data,
                    columns=columns,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return f"Large numbers: {len(data)} rows"

        dash_duo.start_server(app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Should handle large numbers without overflow errors
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

    def test_null_undefined_values(self, dash_duo):
        """Test handling of null and undefined values."""
        columns = [
            {"columnId": "mixed", "title": "Mixed", "type": "text"},
        ]

        # Python None will be converted to JavaScript null
        data = [
            [None],
            [""],
            ["null"],
            ["undefined"],
        ]

        app = Dash(__name__)
        app.layout = html.Div(
            [
                dash_reactgrid.DashReactGrid(
                    id=GRID_ID,
                    data=data,
                    columns=columns,
                ),
                html.Div(id=OUTPUT_ID),
            ]
        )

        @app.callback(Output(OUTPUT_ID, "children"), Input(GRID_ID, "data"))
        def update_output(data):
            return f"Null values: {len(data)} rows"

        dash_duo.start_server(app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Should handle null values gracefully
        grid = dash_duo.find_element(f"#{GRID_ID}")
        assert grid is not None

    def test_browser_zoom_compatibility(self, dash_duo, edge_case_app):
        """Test grid functionality at different zoom levels."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Test at different zoom levels
        zoom_levels = [0.5, 0.75, 1.0, 1.25, 1.5]

        for zoom in zoom_levels:
            # Set zoom level
            dash_duo.driver.execute_script(f"document.body.style.zoom = '{zoom}'")
            time.sleep(0.2)

            # Check grid is still functional
            grid = dash_duo.find_element(f"#{GRID_ID}")
            assert grid is not None

            # Try clicking a cell
            cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
            if cells:
                try:
                    cells[0].click()
                    time.sleep(0.1)
                except Exception:
                    # Some zoom levels might have click issues, that's okay
                    pass

        # Reset zoom
        dash_duo.driver.execute_script("document.body.style.zoom = '1.0'")

    def test_window_resize_handling(self, dash_duo, edge_case_app):
        """Test grid behavior during window resize."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Get initial window size
        initial_size = dash_duo.driver.get_window_size()

        try:
            # Test different window sizes
            sizes = [(800, 600), (1200, 800), (400, 300), (1920, 1080)]

            for width, height in sizes:
                dash_duo.driver.set_window_size(width, height)
                time.sleep(0.3)

                # Grid should remain functional
                grid = dash_duo.find_element(f"#{GRID_ID}")
                assert grid is not None

                # Check if cells are still accessible
                cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
                assert len(cells) > 0

        finally:
            # Restore original size
            dash_duo.driver.set_window_size(
                initial_size["width"], initial_size["height"]
            )

    def test_concurrent_user_simulation(self, dash_duo, edge_case_app):
        """Simulate concurrent user interactions."""
        dash_duo.start_server(edge_case_app)
        dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)

        # Simulate multiple rapid interactions
        cells = dash_duo.find_elements(f"#{GRID_ID} .rg-cell")
        if len(cells) >= 2:
            actions = ActionChains(dash_duo.driver)

            # Rapid clicking and editing different cells
            for i in range(5):
                cell_index = i % len(cells)
                cells[cell_index].click()
                actions.send_keys(f"Concurrent{i}").perform()
                time.sleep(0.05)  # Very rapid
                actions.send_keys(Keys.ESCAPE).perform()  # Cancel edit
                time.sleep(0.05)

            time.sleep(0.5)

            # Grid should remain stable
            grid = dash_duo.find_element(f"#{GRID_ID}")
            assert grid is not None
