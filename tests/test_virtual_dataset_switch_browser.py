"""Chrome integration: pending edits remain isolated across live dataset switches."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8073
URL = f"http://127.0.0.1:{PORT}"


def run_test():
    with tempfile.TemporaryDirectory() as folder:
        env = {**os.environ,
               "VIRTUAL_RELIABLE_DB": str(Path(folder) / "switch.sqlite3"),
               "VIRTUAL_RELIABLE_PORT": str(PORT),
               "VIRTUAL_RELIABLE_DROP_ACK": "1",
               "VIRTUAL_RELIABLE_SWITCH_DATASET": "1"}
        process = subprocess.Popen(
            [sys.executable, "-m", "tests.virtual_reliable_browser_app"],
            cwd=ROOT, env=env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True)
        driver = None
        try:
            for _ in range(120):
                try:
                    with urllib.request.urlopen(URL, timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Switchable Dash fixture did not start")
            options = webdriver.ChromeOptions()
            for argument in ("--headless=new", "--no-sandbox",
                             "--disable-dev-shm-usage", "--window-size=1300,900"):
                options.add_argument(argument)
            options.set_capability("unhandledPromptBehavior", "accept")
            driver = webdriver.Chrome(options=options)
            wait = WebDriverWait(driver, 30)
            driver.get(URL)

            def visible(value):
                # Virtual scrolling can remount cells between individual
                # Selenium calls. Read the current DOM in one browser round-trip.
                return driver.execute_script("""
                    return [...document.querySelectorAll('#grid .rg-text-cell')]
                        .some(cell=>cell.textContent.trim()===arguments[0]);
                """, value)

            def sync_status():
                return driver.find_element(
                    By.CSS_SELECTOR, "#grid .drg-sync-status").text

            def outbox(dataset):
                return driver.execute_script("""
                    const key='dash-reactgrid:outbox:v1:'+
                        JSON.stringify(['grid',arguments[0]]);
                    const value=sessionStorage.getItem(key);
                    return value ? JSON.parse(value) : null;
                """, dataset)

            wait.until(lambda _: visible("Row 0"))
            target = wait.until(lambda _: next(
                (cell for cell in driver.find_elements(
                    By.CSS_SELECTOR, "#grid .rg-text-cell")
                 if cell.text.strip() == "Row 0"), None))
            ActionChains(driver).double_click(target).perform()
            editor = wait.until(lambda _: driver.find_element(
                By.CSS_SELECTOR, "#grid .rg-text-celleditor input"))
            editor.send_keys(Keys.CONTROL, "a")
            editor.send_keys("Pending old dataset")
            editor.send_keys(Keys.TAB)
            wait.until(lambda _: "Stored without ACK: 1" in
                       driver.find_element(By.ID, "commit-status").text)
            wait.until(lambda _: outbox("virtual-rows-v1") is not None and
                       len(outbox("virtual-rows-v1")["queue"]) == 1)

            driver.find_element(By.ID, "switch-dataset").click()
            wait.until(lambda _: visible("Replacement 0"))
            wait.until(lambda _: outbox("virtual-rows-v2") is not None)
            assert outbox("virtual-rows-v2")["queue"] == []
            assert len(outbox("virtual-rows-v1")["queue"]) == 1
            assert not visible("Pending old dataset")
            assert "unacknowledged" not in sync_status().lower()

            # Switching back recovers the original queue and retries its
            # identity. The SQLite fixture deduplicates the committed edit.
            driver.find_element(By.ID, "switch-dataset").click()
            wait.until(lambda _: visible("Pending old dataset"))
            wait.until(lambda _: outbox("virtual-rows-v1")["queue"] == [])
            wait.until(lambda _: "All edits acknowledged" in sync_status())
            driver.find_element(By.ID, "switch-dataset").click()
            wait.until(lambda _: visible("Replacement 0"))
            assert not visible("Pending old dataset")
            # Reload resets the fixture to its default (old) dataset.
            # The committed old edit must survive; the replacement rows must
            # never inherit it, even after another dataset switch.
            driver.refresh()
            wait.until(lambda _: visible("Pending old dataset"))
            assert not visible("Replacement 0")
            driver.find_element(By.ID, "switch-dataset").click()
            wait.until(lambda _: visible("Replacement 0"))
            assert not visible("Pending old dataset")
            print("Chrome dataset switch, pending isolation and replay passed")
        finally:
            if driver:
                driver.quit()
            process.terminate()
            try:
                output = process.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:
                process.kill()
                output = process.communicate()[0]
            print("Dash output:", output[-3000:])


if __name__ == "__main__":
    run_test()
