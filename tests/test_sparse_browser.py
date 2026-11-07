"""Browser integration: a real cell edit traverses Dash, SQLite, ACK and reload."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8059
URL = f"http://127.0.0.1:{PORT}"


def await_server():
    for _ in range(120):
        try:
            with urllib.request.urlopen(URL, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("The Dash app did not start")


def run_test():
    with tempfile.TemporaryDirectory() as folder:
        env = {**os.environ, "SPARSE_BROWSER_DB": str(Path(folder) / "data.sqlite3"),
               "SPARSE_BROWSER_PORT": str(PORT)}
        process = subprocess.Popen(
            [sys.executable, "-m", "tests.sparse_browser_app"],
            cwd=ROOT, env=env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True,
        )
        driver = None
        try:
            await_server()
            opts = webdriver.ChromeOptions()
            opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--window-size=1200,900")
            driver = webdriver.Chrome(options=opts)
            wait = WebDriverWait(driver, 20)
            driver.get(URL)
            cells = lambda: driver.find_elements(
                By.CSS_SELECTOR, "#grid .rg-pane-center-middle .rg-text-cell")
            wait.until(lambda _: len(cells()) >= 2)
            assert cells()[0].text == "Alpha", "Initial grid must show Alpha"
            ActionChains(driver).double_click(cells()[0]).perform()
            editor = wait.until(
                lambda _: driver.find_element(
                    By.CSS_SELECTOR, "#grid .rg-text-celleditor input"))
            editor.send_keys(Keys.CONTROL, "a")
            editor.send_keys("Edited")
            editor.send_keys(Keys.TAB)
            wait.until(lambda _: "Committed: 1 / ok" in
                       driver.find_element(By.ID, "last-commit").text)
            wait.until(lambda _: "All edits acknowledged" in
                       driver.find_element(
                           By.CSS_SELECTOR, "#grid .drg-sync-status").text)
            wait.until(lambda _: cells()[0].text == "Edited")
            driver.refresh()
            wait.until(lambda _: len(cells()) >= 2 and cells()[0].text == "Edited")
            assert "All edits acknowledged" in driver.find_element(
                By.CSS_SELECTOR, "#grid .drg-sync-status").text
            print("Browser integration passed: edit -> Dash -> commit -> ACK -> reload")
        except Exception:
            if driver:
                print("Browser DOM for diagnosis:", driver.page_source[-10000:])
            raise
        finally:
            if driver:
                driver.quit()
            process.terminate()
            try:
                output = process.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:
                process.kill()
                output = process.communicate()[0]
            print("Dash output:", output[-3500:])


if __name__ == "__main__":
    run_test()
