"""Chrome Ctrl+A Ctrl+C test for 25k rows, most never loaded into the DOM."""
import json
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

ROOT=Path(__file__).resolve().parents[1]
PORT=8072
URL=f"http://127.0.0.1:{PORT}"

def run():
    with tempfile.TemporaryFile(mode="w+b") as log:
        proc=subprocess.Popen(
            [sys.executable,"-m","tests.large_virtual_clipboard_app"],
            cwd=ROOT,env={**os.environ,"GRID_STREAM_COPY_PORT":str(PORT)},
            stdout=log,stderr=subprocess.STDOUT)
        driver=None
        try:
            for _ in range(120):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as response:
                        if response.status==200:break
                except Exception:time.sleep(.25)
            else:raise RuntimeError("Virtual clipboard fixture did not start")
            opts=webdriver.ChromeOptions()
            opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--window-size=1400,900")
            driver=webdriver.Chrome(options=opts)
            driver.execute_cdp_cmd("Browser.grantPermissions",{
                "origin":URL,"permissions":["clipboardReadWrite","clipboardSanitizedWrite"],
            })
            wait=WebDriverWait(driver,90)
            driver.get(URL)
            cell=wait.until(lambda _:driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-label"))[0]
            cell.click()
            assert len(driver.find_elements(By.CSS_SELECTOR,"#grid .rg-cell"))<1000

            ActionChains(driver).key_down(Keys.CONTROL).send_keys(
                "a").key_up(Keys.CONTROL).perform()
            wait.until(lambda _:"25,050 rows selected" in
                driver.find_element(By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(
                "c").key_up(Keys.CONTROL).perform()

            def clipboard():
                return driver.execute_async_script("""
                    const done=arguments[arguments.length-1];
                    navigator.clipboard.readText().then(done,
                      err=>done("CLIPBOARD ERROR:"+err.message));
                """)
            copied=wait.until(lambda _:(value if (value:=clipboard()).endswith(
                "Row 25049\t25049") else False))
            assert copied.startswith("Row 0\t0\r\n") or copied.startswith("Row 0\t0\n")
            assert "private" not in copied
            assert len(copied.splitlines())==25_050
            assert "Row 12499\t12499" in copied
            assert "Copying selected range" not in driver.find_element(By.ID,"grid").text

            # A normal focused cell may differ from the previously displayed
            # global selection. Ctrl+C must use native focus, while the
            # toolbar's Copy selection must use the displayed full range.
            amount=driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-amount")[1]
            amount.click()
            assert "25,050 rows selected" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(
                "c").key_up(Keys.CONTROL).perform()
            wait.until(lambda _:clipboard()=="1")
            copy_button=wait.until(lambda _:next(
                (button for button in driver.find_elements(
                    By.CSS_SELECTOR,"#grid .drg-virtual-toolbar button")
                 if button.text.strip()=="Copy selection" and button.is_enabled()),
                None))
            copy_button.click()
            restored=wait.until(lambda _:(value if (value:=clipboard()).endswith(
                "Row 25049\t25049") else False))
            assert len(restored.splitlines())==25_050
            assert restored.startswith("Row 0\t0")

            # A loaded cell with an optimistic edit must remain copyable
            # before the server ACK arrives. The provider still has Row 1,
            # so server streaming would return stale data here.
            label=driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-label")[1]
            label.click()
            ActionChains(driver).send_keys("P").perform()
            editor=wait.until(lambda _:driver.switch_to.active_element
                if driver.switch_to.active_element.tag_name=="input" and
                "rg-hidden-element" not in
                    (driver.switch_to.active_element.get_attribute("class") or "")
                else None)
            editor.send_keys("ENDING")
            editor.send_keys(Keys.ARROW_RIGHT)
            wait.until(lambda _:"PENDING" in driver.find_element(
                By.ID,"pending-edit").text)
            edited_value=json.loads(driver.find_element(
                By.ID,"pending-edit").text)["edits"][0]["value"]
            assert edited_value != "Row 1"
            wait.until(lambda _:"unacknowledged edit batch" in
                driver.find_element(By.ID,"grid").text)
            # Click a different cell first: re-clicking an already focused
            # cell can reopen ReactGrid's editor on a double-click sequence,
            # which tests input clipboard behaviour rather than grid copying.
            driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-amount")[1].click()
            driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-label")[1].click()
            wait.until(lambda _:driver.execute_script("""
                return document.activeElement?.classList?.contains(
                  'rg-hidden-element');
            """))
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(
                "c").key_up(Keys.CONTROL).perform()
            try:
                wait.until(lambda _:clipboard()==edited_value)
            except Exception:
                print("Pending copy expected:",repr(edited_value))
                print("Pending copy observed:",repr(clipboard())[:300])
                print("Rendered cell:",driver.find_elements(
                    By.CSS_SELECTOR,"#grid .rg-cell.rg-col-label")[1].text)
                print("Active element:",driver.execute_script("""
                    const e=document.activeElement;
                    return [e?.tagName,e?.className,e?.value];
                """))
                print("Grid errors:",[e.text for e in driver.find_elements(
                    By.CSS_SELECTOR,"#grid [role=alert]")])
                print("Native synthetic copy:",
                      driver.execute_script("""
                        const cell=document.querySelectorAll(
                          '#grid .rg-cell.rg-col-label')[1];
                        const dt=new DataTransfer();
                        const event=new ClipboardEvent('copy',{
                          bubbles:true,cancelable:true,clipboardData:dt});
                        cell.dispatchEvent(event);
                        return {handled:event.defaultPrevented,
                                text:dt.getData('text/plain')};
                      """))
                raise
            assert "unacknowledged edit batch" in driver.find_element(
                By.ID,"grid").text

            # Switching off the streaming URL while a large selection is
            # active must report an actionable limit instead of claiming
            # a clipboard request is being prepared forever.
            select_all=next(button for button in driver.find_elements(
                By.CSS_SELECTOR,"#grid .drg-virtual-toolbar button")
                if button.text.strip()=="Select all")
            select_all.click()
            wait.until(lambda _:"25,050 rows selected" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            driver.find_element(By.ID,"stream-toggle").click()
            wait.until(lambda _:driver.find_element(
                By.ID,"stream-state").text=="Streaming disabled")
            prevented=driver.execute_script("""
                const viewport=document.querySelector(
                  '#grid .drg-virtual-viewport');
                const transfer=new DataTransfer();
                const e=new ClipboardEvent('copy',{
                  bubbles:true,cancelable:true,clipboardData:transfer});
                viewport.dispatchEvent(e);
                return e.defaultPrevented;
            """)
            assert prevented, "Oversized no-stream copy must be intercepted"
            wait.until(lambda _:"Select at most 1,000 rows to copy" in
                driver.find_element(By.CSS_SELECTOR,
                    "#grid .drg-virtual-error").text)
            assert "configure virtualClipboardUrl" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-virtual-error").text
            assert "Preparing selection for clipboard" not in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-virtual-error").text

            print("Chrome virtual clipboard passed: full selection, toolbar focus and pending single-cell copy")
        finally:
            if driver:driver.quit()
            proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
            log.seek(0,os.SEEK_END)
            end=log.tell()
            log.seek(max(0,end-2000))
            print("Fixture log tail:",log.read().decode(errors="replace"))

if __name__=="__main__":run()
