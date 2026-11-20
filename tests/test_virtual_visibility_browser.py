"""Chrome regression for a virtual grid mounted in a collapsed panel."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8074
URL = f"http://127.0.0.1:{PORT}"


def run_test():
    with tempfile.TemporaryDirectory() as folder:
        env = {**os.environ,
               "VIRTUAL_RELIABLE_DB": str(Path(folder) / "hidden.sqlite3"),
               "VIRTUAL_RELIABLE_PORT": str(PORT),
               "VIRTUAL_RELIABLE_START_HIDDEN": "1",
               "VIRTUAL_RELIABLE_DROP_ACK": "0"}
        proc = subprocess.Popen(
            [sys.executable, "-m", "tests.virtual_reliable_browser_app"],
            cwd=ROOT, env=env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True)
        driver = None
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(URL, timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Hidden virtual grid fixture did not start")
            options = webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1300,900")
            driver = webdriver.Chrome(options=options)
            wait = WebDriverWait(driver, 25)
            driver.get(URL)
            wait.until(lambda _: "Fetched 0:" in driver.find_element(
                By.ID, "viewport-status").text)
            viewport = driver.find_element(
                By.CSS_SELECTOR, "#grid .drg-virtual-viewport")
            assert not viewport.is_displayed(), "Fixture must start hidden"
            summary = driver.find_element(By.CSS_SELECTOR,
                                          "#virtual-grid-panel summary")
            summary.click()
            wait.until(lambda _: viewport.is_displayed())

            def cells_correct():
                return driver.execute_script("""
                    const view=document.querySelector('#grid .drg-virtual-viewport');
                    const names=[...view.querySelectorAll('.rg-cell.rg-col-name')];
                    const values=[...view.querySelectorAll('.rg-cell.rg-col-value')];
                    const text=names.map(x=>x.textContent.trim());
                    return view.clientWidth > 300 &&
                        text.includes('Row 0') && text.includes('Row 1') &&
                        names.some(x=>x.getBoundingClientRect().width > 50) &&
                        values.some(x=>x.getBoundingClientRect().width > 40);
                """)

            wait.until(lambda _: cells_correct())
            # A collapsed tab can be opened again, without any edit or window resize.
            summary.click()
            wait.until(lambda _: not viewport.is_displayed())
            summary.click()
            wait.until(lambda _: viewport.is_displayed() and cells_correct())
            driver.execute_script("""
                const view=document.querySelector('#grid .drg-virtual-viewport');
                view.scrollTop=250*25;
                view.dispatchEvent(new Event('scroll',{bubbles:true}));
            """)
            wait.until(lambda _: any(
                cell.text.strip() == "Row 250"
                for cell in driver.find_elements(
                    By.CSS_SELECTOR, "#grid .rg-cell.rg-col-name")))
            print("Hidden virtual grid browser test passed: reveal, remount and scroll")
        finally:
            if driver:
                driver.quit()
            proc.terminate()
            try:
                output = proc.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:
                proc.kill()
                output = proc.communicate()[0]
            print("Dash output:", output[-2000:])


if __name__ == "__main__":
    run_test()
