"""Chrome integration for server-side virtual scrolling + durable sparse edits."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT=Path(__file__).resolve().parents[1]
PORT=8063
URL=f"http://127.0.0.1:{PORT}"

def run_test():
    with tempfile.TemporaryDirectory() as temp:
        env={**os.environ,"VIRTUAL_RELIABLE_DB":str(Path(temp)/"grid.sqlite3"),
             "VIRTUAL_RELIABLE_PORT":str(PORT),"VIRTUAL_RELIABLE_DROP_ACK":"1"}
        process=subprocess.Popen([sys.executable,"-m","tests.virtual_reliable_browser_app"],
                                 cwd=ROOT,env=env,stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT,text=True)
        driver=None
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as result:
                        if result.status==200:break
                except Exception:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Virtual reliable Dash app did not start")
            options=webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1300,900")
            options.set_capability("unhandledPromptBehavior","accept")
            driver=webdriver.Chrome(options=options)
            wait=WebDriverWait(driver,25)
            driver.get(URL)

            def cell(label):
                for el in driver.find_elements(By.CSS_SELECTOR,"#grid .rg-text-cell"):
                    try:
                        if el.text.strip()==label:return el
                    except StaleElementReferenceException:
                        return None  # the async viewport was replaced mid-query
                return None

            def has(label):
                return cell(label) is not None

            def edit(label,new):
                target=wait.until(lambda _: cell(label))
                ActionChains(driver).double_click(target).perform()
                editor=wait.until(lambda _: driver.find_element(
                    By.CSS_SELECTOR,"#grid .rg-text-celleditor input"))
                editor.send_keys(Keys.CONTROL,"a")
                editor.send_keys(new)
                editor.send_keys(Keys.TAB)

            def scroll(row):
                driver.execute_script(
                    """const viewport=document.querySelector('#grid .drg-virtual-viewport');
                       viewport.scrollTop=arguments[0]*25;
                       viewport.dispatchEvent(new Event('scroll',{bubbles:true}));""",row)

            wait.until(lambda _: has("Row 0"))
            edit("Row 0","StartEdited")
            wait.until(lambda _: "Stored without ACK: 1" in
                       driver.find_element(By.ID,"commit-status").text)
            wait.until(lambda _: "unacknowledged" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-sync-status").text)
            scroll(500)
            wait.until(lambda _: has("Row 500"))
            assert len(driver.find_elements(By.CSS_SELECTOR,"#grid .rg-cell"))<800

            # Server committed but the ACK was lost, and row 0 is no longer
            # loaded. A reload must preserve its outbox and deduplicate.
            driver.refresh()
            wait.until(lambda _: has("StartEdited"))
            wait.until(lambda _: "Committed: 1 / ok" in
                       driver.find_element(By.ID,"commit-status").text)
            wait.until(lambda _: "All edits acknowledged" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-sync-status").text)

            scroll(500)
            wait.until(lambda _: has("Row 500"))
            edit("Row 500","MiddleEdited")
            wait.until(lambda _: "Committed: 2 / ok" in
                       driver.find_element(By.ID,"commit-status").text)
            wait.until(lambda _: "All edits acknowledged" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-sync-status").text)

            scroll(0)
            wait.until(lambda _: has("StartEdited"))
            scroll(500)
            wait.until(lambda _: has("MiddleEdited"))
            driver.refresh()
            wait.until(lambda _: has("StartEdited"))
            scroll(500)
            wait.until(lambda _: has("MiddleEdited"))
            assert "Row 999" not in driver.find_element(By.ID,"grid").text
            print("Virtual reliable browser test passed: scrolling, lost ACK, durable replay, further edit and reload")
        except Exception:
            if driver:
                print("Browser DOM:",driver.page_source[-13000:])
            raise
        finally:
            if driver:driver.quit()
            process.terminate()
            try:output=process.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:
                process.kill()
                output=process.communicate()[0]
            print("Dash output:",output[-4000:])

if __name__=="__main__":
    run_test()
