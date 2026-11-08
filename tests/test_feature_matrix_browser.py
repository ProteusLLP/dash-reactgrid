"""Real Chrome regression suite for the DashReactGrid interactive feature matrix.

Run after npm run build:js and pip install dash selenium:
    python tests/test_feature_matrix_browser.py

Excel interop is tested at its clipboard boundary (quoted TSV and HTML-like
clipboard input); desktop Excel itself is not required by CI.
"""
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8065
URL = f"http://127.0.0.1:{PORT}"


class FeatureMatrixChromeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The Dash fixture can emit more request logs than a PIPE buffer can
        # hold during a long browser suite. A blocked logging write would
        # deadlock the Dash server and make Selenium calls appear to hang.
        cls.server_log = tempfile.TemporaryFile(mode="w+b")
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "tests.feature_matrix_browser_app"],
            cwd=ROOT,
            env={**os.environ, "GRID_MATRIX_BROWSER_PORT": str(PORT)},
            stdout=cls.server_log, stderr=subprocess.STDOUT,
        )
        cls.driver = None
        try:
            for _ in range(120):
                try:
                    with urllib.request.urlopen(URL, timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(.2)
            else:
                raise RuntimeError("Feature matrix Dash app failed to start")

            options = webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1650,1100")
            options.set_capability("unhandledPromptBehavior", "accept")
            cls.driver = webdriver.Chrome(options=options)
            cls.driver.execute_cdp_cmd("Browser.grantPermissions", {
                "origin": URL,
                "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"],
            })
            cls.waiter = WebDriverWait(cls.driver, 25)
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "driver", None):
            cls.driver.quit()
            cls.driver = None
        if getattr(cls, "server", None):
            cls.server.terminate()
            try:
                cls.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.server.kill()
                cls.server.wait()
            if getattr(cls, "server_log", None):
                cls.server_log.seek(0, os.SEEK_END)
                size = cls.server_log.tell()
                cls.server_log.seek(max(0, size - 4000))
                output = cls.server_log.read().decode("utf-8", errors="replace")
                cls.server_log.close()
                if output:
                    print("Feature matrix Dash output:", output)

    def setUp(self):
        # The virtual fixture intentionally has no acknowledgement callback.
        # Do not carry its durable outbox into the next independent test.
        if self.driver.current_url.startswith(URL):
            self.driver.execute_script("window.sessionStorage.clear()")
        self.driver.get(URL)
        self.waiter.until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "#matrix .rg-col-text.rg-cell")) >= 2
        )
        self.waiter.until(lambda _: self.state("matrix").get("data"))

    def state(self, grid):
        text = self.driver.find_element(By.ID, grid + "-state").text
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {}

    def cells(self, grid, column):
        return self.driver.find_elements(
            By.CSS_SELECTOR, f"#{grid} .rg-cell.rg-col-{column}"
        )

    def cell(self, grid, column, index=0):
        return self.waiter.until(
            lambda _: self.cells(grid, column)[index]
            if len(self.cells(grid, column)) > index else None
        )

    def press(self, key, grid="matrix", column="text", index=0):
        cell = self.cell(grid, column, index)
        cell.click()
        ActionChains(self.driver).key_down(Keys.CONTROL).send_keys(
            key
        ).key_up(Keys.CONTROL).perform()

    def paste(self, grid, text, html=None, column="text", index=0):
        # DataTransfer follows Chrome's native ClipboardEvent API; this tests
        # exactly the formats an Excel or another ReactGrid paste supplies.
        return self.driver.execute_script("""
            const target = arguments[0];
            const dt = new DataTransfer();
            dt.setData('text/plain', arguments[1]);
            if (arguments[2] !== null) dt.setData('text/html', arguments[2]);
            const event = new ClipboardEvent('paste', {
              bubbles:true, cancelable:true, clipboardData:dt
            });
            target.dispatchEvent(event);
            return {prevented:event.defaultPrevented};
        """, self.cell(grid, column, index), text, html)

    def copy(self, grid, column="text", index=0):
        return self.driver.execute_script("""
            const dt=new DataTransfer();
            const event=new ClipboardEvent('copy',{
              bubbles:true,cancelable:true,clipboardData:dt
            });
            arguments[0].dispatchEvent(event);
            return {prevented:event.defaultPrevented,
                    plain:dt.getData('text/plain')};
        """, self.cell(grid, column, index))

    def edit(self, grid, column, text, index=0):
        ActionChains(self.driver).double_click(
            self.cell(grid, column, index)
        ).perform()

        def active_editor(_):
            # ReactGrid can render an editor outside the original cell node,
            # so target the focused input, ignoring its hidden focus sentinel.
            candidate = self.driver.switch_to.active_element
            if candidate.tag_name != "input":
                return None
            if "rg-hidden-element" in (candidate.get_attribute("class") or ""):
                return None
            inside = self.driver.execute_script(
                "return !!arguments[0].closest(arguments[1]);",
                candidate, f"#{grid}",
            )
            return candidate if inside else None

        field = self.waiter.until(active_editor)
        field.send_keys(Keys.CONTROL, "a")
        field.send_keys(text)
        if column == "text":
            field.send_keys(Keys.TAB)
        else:
            # The custom numeric editor rejects Tab while typing; commit
            # through its onBlur handler by moving focus outside the grid.
            self.driver.find_element(By.TAG_NAME, "h3").click()

    def type_in_focused(self, value, expect_editor=True):
        # The first keystroke creates an input asynchronously. Do not send a
        # second key to ReactGrid's hidden focus element before it is mounted:
        # Selenium can otherwise drop a digit at unrealistically high speed.
        for index, character in enumerate(value):
            ActionChains(self.driver).send_keys(character).perform()
            if expect_editor and index == 0:
                WebDriverWait(self.driver, 5).until(
                    lambda d: d.execute_script("""
                        const e=document.activeElement;
                        return e?.tagName==='INPUT' &&
                          !e.classList.contains('rg-hidden-element');
                    """)
                )

    def expect_focus(self, grid, row_id, column_id):
        WebDriverWait(self.driver, 5).until(lambda _: self.state(grid).get("selectedCell") == {
            "rowId": row_id, "columnId": column_id,
        })

    def chord(self, *keys):
        action = ActionChains(self.driver)
        for modifier in [Keys.CONTROL, Keys.SHIFT]:
            if modifier in keys:
                action.key_down(modifier)
        for key in keys:
            if key not in (Keys.CONTROL, Keys.SHIFT):
                action.send_keys(key)
        for modifier in [Keys.SHIFT, Keys.CONTROL]:
            if modifier in keys:
                action.key_up(modifier)
        action.perform()

    def test_ctrl_arrows_select_and_fill_down_with_undo(self):
        self.cell("target", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.ARROW_DOWN)
        self.expect_focus("target", "target-2", "label")
        self.chord(Keys.CONTROL, Keys.ARROW_UP)
        self.expect_focus("target", "target-1", "label")
        self.chord(Keys.CONTROL, Keys.ARROW_RIGHT)
        self.expect_focus("target", "target-1", "value")
        self.chord(Keys.CONTROL, Keys.ARROW_LEFT)
        self.expect_focus("target", "target-1", "label")
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        self.waiter.until(
            lambda _: self.state("target").get("selectedRowIds") ==
                ["target-1", "target-2"]
        )
        copied = self.copy("target", "label")
        self.assertEqual(copied["plain"], "Target 1\nTarget 2")
        self.chord(Keys.CONTROL, "d")
        self.waiter.until(
            lambda _: self.state("target")["data"][1][0] == "Target 1"
        )
        self.chord(Keys.CONTROL, "z")
        self.waiter.until(
            lambda _: self.state("target")["data"][1][0] == "Target 2"
        )

    def test_shift_enter_applies_one_edit_to_selected_cells(self):
        self.cell("target", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        self.type_in_focused("Broadcast")
        self.chord(Keys.SHIFT, Keys.ENTER)
        self.waiter.until(
            lambda _: [row[0] for row in self.state("target")["data"]] ==
                ["Broadcast", "Broadcast"]
        )
        self.assertEqual(
            [row[1] for row in self.state("target")["data"]], [1, 2]
        )

    def test_ctrl_arrow_navigates_across_paged_table(self):
        self.cell("paged", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.ARROW_DOWN)
        self.expect_focus("paged", "p10", "label")
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_UP)
        self.waiter.until(lambda _: self.state("paged").get("selectedRowIds") ==
            [f"p{i}" for i in range(11)])
        copied = self.copy("paged", "label", 0)
        self.assertEqual(copied["plain"].splitlines(),
            [f"Page row {i}" for i in range(11)])
        self.chord(Keys.CONTROL, Keys.ARROW_UP)
        self.expect_focus("paged", "p0", "label")

    def test_server_virtual_ctrl_arrow_and_range_selection(self):
        self.cell("review-virtual", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.ARROW_DOWN)
        self.waiter.until(lambda _: "Second" in
            self.driver.find_element(By.ID, "review-virtual").text)
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_RIGHT)
        self.waiter.until(lambda _: len(self.driver.find_elements(
            By.CSS_SELECTOR, "#review-virtual .rg-virtual-selected"
        )) >= 2)

    def test_server_virtual_fill_down_uses_sparse_range_command(self):
        self.cell("review-virtual", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        self.chord(Keys.CONTROL, "d")

        def emitted():
            try:
                batch = json.loads(self.driver.find_element(
                    By.ID, "review-virtual-edits").text)
                return batch.get("edits") == [{
                    "kind": "fillDown", "sourceRow": 0, "start": 1, "end": 2,
                    "columnIds": ["label"],
                }]
            except (ValueError, AttributeError):
                return False

        self.waiter.until(lambda _: emitted())

    def test_server_virtual_fill_down_uses_current_cell_after_range_selection(self):
        self.cell("review-virtual", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        # A subsequent ordinary click must take precedence over the old
        # two-row label selection when Ctrl+D is pressed.
        self.cell("review-virtual", "day", 1).click()
        self.chord(Keys.CONTROL, "d")

        def emitted():
            try:
                batch=json.loads(self.driver.find_element(
                    By.ID, "review-virtual-edits").text)
                return batch.get("edits")==[{
                    "kind":"fillDown","sourceRow":0,"start":1,"end":2,
                    "columnIds":["day"],
                }]
            except (ValueError,AttributeError):
                return False

        self.waiter.until(lambda _:emitted())

    def test_server_virtual_shift_enter_uses_focused_cell_after_range_selection(self):
        self.cell("review-virtual", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        self.cell("review-virtual", "label", 1).click()
        self.type_in_focused("Only")
        self.chord(Keys.SHIFT, Keys.ENTER)

        def emitted():
            try:
                batch=json.loads(self.driver.find_element(
                    By.ID, "review-virtual-edits").text)
                return batch.get("edits")==[{
                    "kind":"cell","rowId":"vr-1",
                    "columnId":"label","value":"Only",
                }]
            except (ValueError,AttributeError):
                return False

        self.waiter.until(lambda _:emitted())

    def test_server_virtual_shift_enter_submits_multi_cell_fill(self):
        self.cell("review-virtual", "label", 0).click()
        self.chord(Keys.CONTROL, Keys.SHIFT, Keys.ARROW_DOWN)
        self.type_in_focused("Shared")
        self.chord(Keys.SHIFT, Keys.ENTER)

        def emitted():
            try:
                batch = json.loads(self.driver.find_element(
                    By.ID, "review-virtual-edits").text)
                return batch.get("edits") == [{
                    "kind": "fillRange", "start": 0, "end": 2,
                    "columnIds": ["label"], "values": ["Shared"],
                }]
            except (ValueError, AttributeError):
                return False

        self.waiter.until(lambda _: emitted())

    def test_direct_typing_and_arrow_navigation_all_text_numeric_percent(self):
        cases = [
            ("text", 0, "Direct edit!", 0, "Direct edit!", "amount", "r1"),
            ("amount", 1, "31.25", 1, 31.25, "custom", "r2"),
            ("custom", 0, "-14.75", 2, -14.75, "percent", "r1"),
            ("percent", 0, "37", 3, .37, "choice", "r1"),
            ("conditional", 0, "Now editable", 8, "Now editable", "fixed", "r1"),
        ]
        for column, index, typed, position, expected, next_col, row_id in cases:
            with self.subTest(column=column):
                self.driver.get(URL)
                self.waiter.until(lambda _: self.state("matrix").get("data"))
                self.cell("matrix", column, index).click()
                self.type_in_focused(typed)
                ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
                WebDriverWait(self.driver, 5).until(
                    lambda _: self.state("matrix")["data"][index][position] == expected
                )
                self.expect_focus("matrix", row_id, next_col)

    def test_direct_typing_date_and_time_commits_with_arrow(self):
        self.cell("matrix", "day", 0).click()
        self.type_in_focused("2026-11-14")
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        self.waiter.until(lambda _: str(self.state("matrix")["data"][0][6]).startswith("2026-11-14"))
        self.expect_focus("matrix", "r1", "clock")

        self.type_in_focused("15:45")
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        WebDriverWait(self.driver, 5).until(lambda _: "15:45" in str(self.state("matrix")["data"][0][7]))
        self.expect_focus("matrix", "r1", "conditional")

    def test_dropdown_type_to_select_then_navigate_and_checkbox_space(self):
        # Reach the dropdown through keyboard navigation, not a pointer click
        # that opens the dropdown before any typed characters.
        self.cell("matrix", "percent", 0).click()
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        self.expect_focus("matrix", "r1", "choice")
        self.type_in_focused("F")
        self.type_in_focused("inished")
        ActionChains(self.driver).send_keys(Keys.ENTER).perform()
        self.waiter.until(lambda _: self.state("matrix")["data"][0][4] == "closed")
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        self.expect_focus("matrix", "r1", "flag")

        ActionChains(self.driver).send_keys(Keys.SPACE).perform()
        self.waiter.until(lambda _: self.state("matrix")["data"][0][5] is False)
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        self.expect_focus("matrix", "r1", "day")

    def test_tab_and_arrows_chain_edits_without_double_click(self):
        self.cell("target", "label", 0).click()
        self.type_in_focused("First")
        ActionChains(self.driver).send_keys(Keys.TAB).perform()
        self.waiter.until(lambda _: self.state("target")["data"][0][0] == "First")
        self.expect_focus("target", "target-1", "value")

        self.type_in_focused("99.25")
        ActionChains(self.driver).send_keys(Keys.ARROW_DOWN).perform()
        self.waiter.until(lambda _: self.state("target")["data"][0][1] == 99.25)
        self.expect_focus("target", "target-2", "value")

        self.type_in_focused("-101.5")
        ActionChains(self.driver).send_keys(Keys.ARROW_LEFT).perform()
        self.waiter.until(lambda _: self.state("target")["data"][1][1] == -101.5)
        self.expect_focus("target", "target-2", "label")

        self.type_in_focused("Second")
        ActionChains(self.driver).send_keys(Keys.ARROW_UP).perform()
        self.waiter.until(lambda _: self.state("target")["data"][1][0] == "Second")
        self.expect_focus("target", "target-1", "label")

    def test_enter_commits_direct_numeric_edit(self):
        # Enter after typing should save the active cell, just as ArrowDown
        # and Tab do. Navigation is separately asserted in the chain test.
        self.cell("target", "value", 0).click()
        self.type_in_focused("44.5")
        ActionChains(self.driver).send_keys(Keys.ENTER).perform()
        self.waiter.until(lambda _: self.state("target")["data"][0][1] == 44.5)

    def test_keyboard_direct_entry_respects_locks_and_extendable_rows(self):
        self.cell("matrix", "amount", 0).click()
        self.type_in_focused("999", expect_editor=False)
        ActionChains(self.driver).send_keys(Keys.ARROW_RIGHT).perform()
        self.assertEqual(self.state("matrix")["data"][0][1], 10.5)

        self.cell("matrix", "conditional", 1).click()
        self.type_in_focused("Blocked", expect_editor=False)
        ActionChains(self.driver).send_keys(Keys.ARROW_LEFT).perform()
        self.assertEqual(self.state("matrix")["data"][1][8], "Disabled")

        self.cell("matrix", "fixed", 0).click()
        self.type_in_focused("Blocked", expect_editor=False)
        ActionChains(self.driver).send_keys(Keys.ARROW_LEFT).perform()
        self.assertEqual(self.state("matrix")["data"][0][9], "Immutable")

        self.cell("readonly", "label", 0).click()
        self.type_in_focused("Blocked", expect_editor=False)
        ActionChains(self.driver).send_keys(Keys.TAB).perform()
        self.assertEqual(self.state("readonly")["data"][0][0], "Protected")

        self.cell("matrix", "text", 2).click()
        self.type_in_focused("Third by keyboard")
        ActionChains(self.driver).send_keys(Keys.TAB).perform()
        self.waiter.until(lambda _: len(self.state("matrix")["data"]) == 3)
        self.assertEqual(self.state("matrix")["data"][2][0], "Third by keyboard")
        self.assertEqual(self.state("matrix")["data"][2][4], "open")

    def test_header_tooltips_in_normal_and_virtual_grids(self):
        """Native tooltips attach only to configured visible headers."""
        self.waiter.until(lambda d: d.find_elements(
            By.CSS_SELECTOR, "#matrix .rg-header-cell .drg-header-tooltip"))
        labels = self.driver.find_elements(
            By.CSS_SELECTOR, "#matrix .rg-header-cell .drg-header-tooltip")
        tooltip_by_title = {label.text: label.get_attribute("title") for label in labels}
        self.assertEqual(tooltip_by_title["Text"], "A free-form text value")
        self.assertEqual(tooltip_by_title["Amount"], "Amount in pounds")
        self.assertNotIn("Choice", tooltip_by_title)
        self.assertEqual(self.driver.find_elements(
            By.CSS_SELECTOR, "#target .rg-header-cell .drg-header-tooltip"), [])
        self.waiter.until(lambda d: d.find_elements(
            By.CSS_SELECTOR, "#review-virtual .rg-header-cell .drg-header-tooltip"))
        virtual = self.driver.find_elements(
            By.CSS_SELECTOR, "#review-virtual .rg-header-cell .drg-header-tooltip")
        self.assertTrue(any(cell.text == "Label" and
                            cell.get_attribute("title") == "Server-backed label"
                            for cell in virtual))

    def test_numpy_backed_normal_and_server_virtual_grids(self):
        self.waiter.until(lambda _: len(self.cells("numeric", "a")) >= 2)
        self.assertIn("1.25", self.cell("numeric", "a", 0).text)
        self.assertIn("2.5", self.cell("numeric", "b", 0).text)
        # Existing editing path must publish ordinary rows, not a typed-array
        # object, when the user has selected full-data transmission.
        self.edit("numeric", "b", "9.5", 0)
        self.waiter.until(lambda _: self.state("numeric").get("data") is not None
                          and isinstance(self.state("numeric")["data"], list)
                          and self.state("numeric")["data"][0][1] == 9.5)
        self.assertIn("-4.5", self.cell("numeric", "a", 1).text)
        self.waiter.until(lambda _: len(self.cells("numeric-virtual", "a")) >= 2)
        self.assertIn("0", self.cell("numeric-virtual", "a", 0).text)
        self.assertIn("1", self.cell("numeric-virtual", "b", 0).text)

    def test_renders_every_column_type_with_conditional_lock_and_hidden_column(self):
        for column in ("text", "amount", "custom", "percent", "choice",
                       "flag", "day", "clock", "conditional", "fixed"):
            with self.subTest(column=column):
                self.assertGreaterEqual(len(self.cells("matrix", column)), 2)
        self.assertEqual(self.cells("matrix", "secret"), [])
        self.assertIn("rg-cell-editable", self.cell("matrix", "text").get_attribute("class"))
        self.assertNotIn("rg-cell-editable", self.cell("matrix", "amount").get_attribute("class"))
        self.assertIn("rg-cell-na", self.cell(
            "matrix", "conditional", 1).get_attribute("class"))
        self.assertNotIn("rg-cell-editable", self.cell(
            "matrix", "fixed").get_attribute("class"))
        self.assertGreaterEqual(len(self.driver.find_elements(
            By.CSS_SELECTOR, "#matrix .rg-ghost")), 1)
        self.assertFalse(self.driver.find_elements(
            By.CSS_SELECTOR, "#readonly .rg-ghost"))
        self.assertNotIn("rg-cell-editable",
                         self.cell("readonly", "label").get_attribute("class"))

    def test_text_edit(self):
        self.edit("matrix", "text", "Changed")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][0] == "Changed")

    def test_number_direct_edit_regression(self):
        # Ctrl+A replaces the existing numeric value inside its input.
        self.edit("matrix", "amount", "31.25", index=1)
        self.waiter.until(lambda _: self.state("matrix")["data"][1][1] == 31.25)

    def test_text_edit_undo_redo_regression(self):
        # Focus an untouched, noneditable cell before invoking grid history;
        # clicking the edited text cell again could reopen its text editor.
        self.edit("matrix", "text", "Changed")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][0] == "Changed")
        self.press("z", "matrix", "fixed")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][0] == "Alpha")
        self.press("y", "matrix", "fixed")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][0] == "Changed")

    def test_custom_number_direct_editing(self):
        self.edit("matrix", "custom", "14.75")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][2] == 14.75)

    def test_paste_blank_cells_clears_text_and_number(self):
        self.cell("target", "label", 0).click()
        result = self.paste("target", "\t", column="label")
        self.assertTrue(result["prevented"])
        self.waiter.until(lambda _: self.state("target")["data"][0] == ["", None])
        self.assertEqual(self.state("target")["data"][1], ["Target 2", 2])

    def test_ghost_row_paste_respects_noneditable_column(self):
        self.cell("matrix", "text", 2).click()
        result = self.paste(
            "matrix", "New row" + "\t" * 8 + "Forbidden",
            column="text", index=2,
        )
        self.assertTrue(result["prevented"])
        self.waiter.until(lambda _: len(self.state("matrix")["data"]) == 3)
        self.assertEqual(self.state("matrix")["data"][-1][0], "New row")
        self.assertNotEqual(self.state("matrix")["data"][-1][9], "Forbidden")
        self.assertIsNone(self.state("matrix")["data"][-1][9])

    def test_excel_clipboard_paste_respects_types_locks_and_edit_rules(self):
        self.press("a")
        excel_tsv = (
            "From Excel\t999\t-12.5\t35%\tIn progress\tTRUE\t"
            "2026-11-05\t2026-11-05T11:15:00Z\tAllowed\tChanged fixed\n"
            "Second\t33\t4.25\t12.5%\tFinished\tFALSE\t"
            "2026-11-06\t2026-11-06T15:00:00Z\tDisallowed\tChanged fixed"
        )
        self.assertTrue(self.paste("matrix", excel_tsv)["prevented"])
        self.waiter.until(lambda _: self.state("matrix")["data"][0][0] == "From Excel")
        rows = self.state("matrix")["data"]
        self.assertEqual(rows[0][1], 10.5, "locked cells cannot be overwritten")
        self.assertEqual(rows[0][2], -12.5)
        self.assertAlmostEqual(rows[0][3], .35)
        self.assertEqual(rows[0][4], "open", "dropdown label resolves to stored value")
        self.assertTrue(rows[0][5])
        self.assertEqual(rows[0][6], "2026-11-05")
        self.assertEqual(rows[0][7], "2026-11-05T11:15:00Z")
        self.assertEqual(rows[0][8], "Allowed")
        self.assertEqual(rows[0][9], "Immutable")
        self.assertEqual(rows[1][0], "Second")
        self.assertEqual(rows[1][1], 33)
        self.assertAlmostEqual(rows[1][3], .125)
        self.assertEqual(rows[1][8], "Disabled",
                         "conditional rule evaluated against original row")
        self.assertEqual(rows[1][9], "Immutable")
        self.assertEqual(len(rows[0]), 11, "hidden values stay in source rows")
        self.assertEqual(rows[0][10], "not-visible")

    def test_ctrl_a_copy_and_excel_quoted_tsv_between_two_grids(self):
        self.press("a", "source", "label")
        copied = self.copy("source", "label")
        self.assertTrue(copied["prevented"])
        records = list(csv.reader(io.StringIO(copied["plain"]), delimiter="\t"))
        self.assertEqual(records, [
            ["Label", "Value"], ['A "quoted"', "12.5"],
            ["Tab\tand\nnewline", "25"],
        ])
        # A native Chrome Ctrl+C must place the entire selection, not merely
        # the focused cell, on the system clipboard.
        ActionChains(self.driver).key_down(Keys.CONTROL).send_keys(
            "c"
        ).key_up(Keys.CONTROL).perform()
        actual = self.driver.execute_async_script("""
          const done=arguments[arguments.length-1];
          navigator.clipboard.readText().then(done,e=>done('ERROR:'+e.message));
        """)
        self.assertEqual(
            list(csv.reader(io.StringIO(actual), delimiter="\t")), records
        )
        outgoing = io.StringIO()
        writer = csv.writer(outgoing, delimiter="\t", lineterminator="\r\n")
        writer.writerows(records[1:])
        self.press("a", "target", "label")
        self.assertTrue(self.paste("target", outgoing.getvalue(), column="label")["prevented"])
        self.waiter.until(lambda _: self.state("target")["data"][0][0] == 'A "quoted"')
        self.assertEqual(self.state("target")["data"], [
            ['A "quoted"', 12.5], ["Tab\tand\nnewline", 25],
        ])


    def test_multicell_clipboard_undo_regression(self):
        # Focus a different cell to make sure undo reaches the grid rather
        # than a text editor reopened by clicking the recently pasted cell.
        self.press("a", "target", "label")
        self.assertTrue(self.paste(
            "target", "Changed\t100\nAnother\t200", column="label"
        )["prevented"])
        self.waiter.until(lambda _: self.state("target")["data"][0][0] == "Changed")
        # A header cannot open an editor. Send the real shortcut from the
        # grid focus, instead of clicking an editable cell before Ctrl+Z.
        self.driver.find_element(By.CSS_SELECTOR, "#target .rg-header-cell").click()
        ActionChains(self.driver).key_down(Keys.CONTROL).send_keys(
            "z").key_up(Keys.CONTROL).perform()
        self.waiter.until(
            lambda _: self.state("target")["data"] == [
                ["Target 1", 1], ["Target 2", 2]
            ]
        )
        ActionChains(self.driver).key_down(Keys.CONTROL).send_keys(
            "y").key_up(Keys.CONTROL).perform()
        self.waiter.until(
            lambda _: self.state("target")["data"] == [
                ["Changed", 100], ["Another", 200]
            ]
        )

    def test_dropdown_portal_and_conditional_editability(self):
        self.cell("matrix", "choice").click()
        option = self.waiter.until(lambda _: next((
            element for element in self.driver.find_elements(
                By.CSS_SELECTOR, ".drg-dropdown-menu-portal .rg-dropdown-option"
            ) if "Finished" in element.text and element.is_displayed()
        ), None))
        self.assertEqual(self.driver.execute_script(
            "return arguments[0].closest('body')===document.body", option
        ), True)
        option.click()
        self.waiter.until(lambda _: self.state("matrix")["data"][0][4] == "closed")
        self.waiter.until(lambda _: "rg-cell-na" in self.cell(
            "matrix", "conditional").get_attribute("class"))


    def test_checkbox_click_and_undo(self):
        self.assertTrue(self.state("matrix")["data"][0][5])
        self.cell("matrix", "flag").click()
        self.waiter.until(lambda _: self.state("matrix")["data"][0][5] is False)
        self.press("z", "matrix", "text")
        self.waiter.until(lambda _: self.state("matrix")["data"][0][5] is True)

    def test_native_chrome_paste_and_excel_html_fallback(self):
        self.press("a", "target", "label")
        copied = "From Chrome\t125.5\nSecond row\t-7.25"
        result = self.driver.execute_async_script("""
          const done=arguments[arguments.length-1];
          navigator.clipboard.writeText(arguments[0]).then(
            ()=>done('ok'),e=>done('ERROR:'+e.message));
        """, copied)
        self.assertEqual(result, "ok")
        ActionChains(self.driver).key_down(Keys.CONTROL).send_keys(
            "v"
        ).key_up(Keys.CONTROL).perform()
        self.waiter.until(lambda _: self.state("target")["data"][0][0] == "From Chrome")
        self.assertEqual(self.state("target")["data"], [
            ["From Chrome", 125.5], ["Second row", -7.25],
        ])

        # Excel provides both HTML and plain TSV; its HTML is not ReactGrid
        # internal markup, so the textual clipboard representation wins.
        self.press("a", "target", "label")
        html = "<html><body><table><tr><td>Ignored HTML</td></tr></table></body></html>"
        result = self.paste("target", '"Excel\tquoted"\t19.5', html=html, column="label")
        self.assertTrue(result["prevented"])
        self.waiter.until(lambda _: self.state("target")["data"][0][1] == 19.5)
        self.assertEqual(self.state("target")["data"][0][0], "Excel\tquoted")

    def test_extendable_ghost_row_uses_defaults_and_paged_paste_is_bounded(self):
        ghost = self.driver.find_element(
            By.CSS_SELECTOR, "#matrix .rg-cell.rg-col-text.rg-ghost"
        )
        ActionChains(self.driver).double_click(ghost).perform()
        editor = self.waiter.until(lambda _: self.driver.find_element(
            By.CSS_SELECTOR, "#matrix .rg-text-celleditor input"))
        editor.send_keys("New row")
        editor.send_keys(Keys.TAB)
        self.waiter.until(lambda _: len(self.state("matrix")["data"]) == 3)
        rows = self.state("matrix")["data"]
        self.assertEqual(rows[-1][0], "New row")
        self.assertEqual(rows[-1][4], "open")
        self.assertIs(rows[-1][5], False)
        self.assertTrue(self.state("matrix")["rowIds"][-1].startswith("new-"))

        self.press("a", "paged", "label")
        oversized = "".join(f"pasted-{i}\t{i}\n" for i in range(6))
        self.assertTrue(self.paste("paged", oversized, column="label")["prevented"])
        self.waiter.until(lambda _: self.state("paged")["data"][0][0] == "pasted-0")
        data = self.state("paged")["data"]
        self.assertEqual([row[0] for row in data[:4]],
                         [f"pasted-{i}" for i in range(4)])
        self.assertEqual(data[4], ["Page row 4", 4])
        self.assertEqual(len(data), 11)

        next_button = next(b for b in self.driver.find_elements(
            By.CSS_SELECTOR, "#paged .drg-pager button") if b.text == "Next")
        next_button.click()
        self.waiter.until(lambda _: "Rows 5-8 of 11" in self.driver.find_element(
            By.CSS_SELECTOR, "#paged .drg-pager").text)
        self.assertIn("Page row 4", self.driver.find_element(By.ID, "paged").text)
        self.assertNotIn("Page row 0", self.driver.find_element(By.ID, "paged").text)
        next_button = next(b for b in self.driver.find_elements(
            By.CSS_SELECTOR, "#paged .drg-pager button") if b.text == "Next")
        next_button.click()
        self.waiter.until(lambda _: "Rows 9-11 of 11" in self.driver.find_element(
            By.CSS_SELECTOR, "#paged .drg-pager").text)
        self.assertTrue(self.driver.find_elements(
            By.CSS_SELECTOR, "#paged .rg-ghost.rg-col-label"))

    def test_right_click_delete_row_and_read_only_guard(self):
        ActionChains(self.driver).context_click(
            self.cell("matrix", "text", 0)
        ).perform()
        action = self.waiter.until(lambda _: next((
            element for element in self.driver.find_elements(
                By.XPATH, "//*[normalize-space(text())='Delete row']"
            ) if element.is_displayed()
        ), None))
        action.click()
        self.waiter.until(lambda _: len(self.state("matrix")["data"]) == 1)
        self.assertEqual(self.state("matrix")["data"][0][0], "Beta")
        self.assertEqual(self.state("matrix")["rowIds"], ["r2"])

        before = self.state("readonly")["data"]
        self.press("a", "readonly", "label")
        self.paste("readonly", "Cannot change\t999", column="label")
        self.assertEqual(self.state("readonly")["data"], before)
        self.assertFalse(self.driver.find_elements(
            By.CSS_SELECTOR, "#readonly .rg-ghost"))

    def tearDown(self):
        if self._outcome and not self._outcome.success:
            try:
                print("Diagnostic state:", self.driver.execute_script("""
                    return {
                      matrix:document.querySelector('#matrix-state')?.textContent,
                      target:document.querySelector('#target-state')?.textContent,
                      paged:document.querySelector('#paged-state')?.textContent,
                      menu:document.querySelector('.rg-context-menu')?.textContent,
                      errors:[...document.querySelectorAll('[role=alert]')]
                        .map(x=>x.textContent),
                    };
                """))
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
