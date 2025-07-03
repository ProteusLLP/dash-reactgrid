from dash.testing.application_runners import import_app
import time
import pytest
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains


def test_render_component(dash_duo):
    """Test that the usage example renders and allows cell editing."""
    # Start a dash app contained as the variable `app` in `usage.py`
    app = import_app("usage")
    dash_duo.start_server(app)

    # Wait for the grid to be present
    dash_duo.wait_for_element("#grid", timeout=10)

    # Find cells using more robust selectors
    # Look for the first data cell (should contain "hello")
    cells = dash_duo.find_elements("#grid .rg-cell")
    assert len(cells) > 0, "No cells found in grid"

    # Find the first data cell (not header) that contains "hello"
    first_cell = None
    for cell in cells:
        if cell.text and "hello" in cell.text:
            first_cell = cell
            break

    assert (
        first_cell is not None
    ), f"Could not find cell with 'hello'. Available cells: {[cell.text for cell in cells]}"
    assert "hello" == first_cell.text.strip()

    # Click the cell to edit it
    first_cell.click()
    time.sleep(0.5)

    # Clear existing content and type new text (testing actual typing)
    text_to_type = "Hello dash"

    # Use ActionChains for more reliable key handling in Dash 3.0
    actions = ActionChains(dash_duo.driver)

    # Type the text with proper timing
    actions = ActionChains(dash_duo.driver)
    actions.send_keys(text_to_type)
    actions.perform()

    # Press Enter to confirm
    actions = ActionChains(dash_duo.driver)
    actions.send_keys(Keys.ENTER)
    actions.perform()

    # Find the updated cell and verify the change
    updated_cells = dash_duo.find_elements("#grid .rg-cell")
    updated_cell = None
    for cell in updated_cells:
        if cell.text and "Hello dash" in cell.text:
            updated_cell = cell
            break

    assert (
        updated_cell is not None
    ), f"Could not find updated cell. Available cells: {[cell.text for cell in updated_cells]}"
    assert "Hello dash" == updated_cell.text.strip()
