"""End-to-end Chrome test for server-virtual structural and range operations."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from examples.virtual_grid_store import VirtualGridStore
PORT=8063
URL=f"http://127.0.0.1:{PORT}"
COLUMNS=[{"columnId":"name","type":"text"},{"columnId":"value","type":"number"}]

def test():
    with tempfile.TemporaryDirectory() as folder:
        database=Path(folder)/"virtual.sqlite3"
        env={**os.environ,"VIRTUAL_RELIABLE_DB":str(database),
             "VIRTUAL_RELIABLE_PORT":str(PORT),"VIRTUAL_RELIABLE_DROP_ACK":"0"}
        process=subprocess.Popen([sys.executable,"-m","tests.virtual_reliable_browser_app"],
            cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        driver=None
        try:
            for _ in range(120):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as conn:
                        if conn.status==200:break
                except Exception:time.sleep(0.2)
            else:raise RuntimeError("The virtual grid server did not start")
            store=VirtualGridStore(database,"virtual-rows-v1",COLUMNS)
            options=webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1300,900")
            driver=webdriver.Chrome(options=options)
            driver.execute_cdp_cmd("Browser.grantPermissions",{
                "origin":URL,
                "permissions":["clipboardReadWrite","clipboardSanitizedWrite"],
            })
            wait=WebDriverWait(driver,25)
            driver.get(URL)

            def all_buttons():
                return driver.find_elements(By.CSS_SELECTOR,"#grid .drg-virtual-toolbar button")
            def click(label):
                wait.until(lambda _: next(
                    (b for b in all_buttons() if b.text.strip()==label and b.is_enabled()),
                    None,
                )).click()
            def select(start,end):
                inputs=driver.find_elements(By.CSS_SELECTOR,
                    "#grid .drg-virtual-toolbar input[type=number]")
                assert len(inputs)==2
                for el,value in zip(inputs,[start,end]):
                    el.click()
                    el.send_keys(Keys.CONTROL,"a")
                    el.send_keys(str(value))
                click("Select range")
            def synced():
                return "All edits acknowledged" in driver.find_element(
                    By.CSS_SELECTOR,"#grid .drg-sync-status").text
            def copy_ready():
                return next((b.is_enabled() for b in all_buttons()
                             if b.text.strip()=="Copy selection"),False)
            def clipboard():
                return driver.execute_async_script("""
                  const done=arguments[arguments.length-1];
                  navigator.clipboard.readText().then(done,e=>done('ERROR:'+e.message));
                """)
            def paste(text):
                result=driver.execute_script("""
                  const transfer=new DataTransfer();
                  transfer.setData('text/plain',arguments[0]);
                  const event=new ClipboardEvent('paste',{
                    bubbles:true,cancelable:true,clipboardData:transfer,
                  });
                  document.querySelector('#grid .drg-virtual-viewport').dispatchEvent(event);
                  return event.defaultPrevented;
                """,text)
                assert result, "The grid must capture and validate pasted text"

            wait.until(lambda _: driver.find_element(By.ID,"viewport-status").text)
            wait.until(lambda _: synced())

            # Copy a row range hundreds of rows away from the loaded viewport.
            select(501,503)
            wait.until(lambda _: copy_ready())
            click("Copy selection")
            wait.until(lambda _: clipboard()=="Row 500\t500\nRow 501\t501\nRow 502\t502")

            # Multi-row paste targets row indices outside the DOM; apply the
            # complete operation atomically in the backend.
            select(501,501)
            paste('Pasted 500\t5000\n"Pasted\t501"\t5001')
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Pasted 500",5000],["Pasted\t501",5001],
            ])
            wait.until(lambda _: synced())
            click("Undo")
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Row 500",500],["Row 501",501],
            ])
            wait.until(lambda _: synced())
            click("Redo")
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Pasted 500",5000],["Pasted\t501",5001],
            ])
            wait.until(lambda _: synced())

            # Insert at an absolute server row index even though the selected
            # row is not loaded in ReactGrid.
            select(501,501)
            click("Insert row")
            wait.until(lambda _: store.row_count()==1001)
            wait.until(lambda _: synced())
            snapshot=store.read_range(500,503)
            assert snapshot["data"][:2]==[[None,None],["Pasted 500",5000]]
            inserted_id=snapshot["rowIds"][0]
            assert inserted_id.startswith("new-")

            # Deleting an unloaded interval shifts later rows and updates the
            # server-owned row count, without re-sending the table to Dash.
            select(501,503)
            click("Delete selected rows")
            driver.switch_to.alert.accept()
            wait.until(lambda _: store.row_count()==998)
            wait.until(lambda _: synced())
            click("Undo")
            wait.until(lambda _: store.row_count()==1001)
            wait.until(lambda _: synced())
            assert store.read_range(500,501)["rowIds"]==[inserted_id]
            click("Redo")
            wait.until(lambda _: store.row_count()==998)
            wait.until(lambda _: synced())

            click("Select all")
            wait.until(lambda _: "998 rows selected" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            link=driver.find_element(By.CSS_SELECTOR,
                "#grid .drg-virtual-toolbar a[download]")
            url=link.get_attribute("href")
            with urllib.request.urlopen(url,timeout=15) as export:
                document=export.read().decode()
            assert document.startswith("name,value\r\n")
            assert len(document.splitlines())==999, "Full-range CSV streaming must include all rows"
            assert "Pasted 500,5000" not in document, "The previously deleted range must stay deleted"

            driver.refresh()
            wait.until(lambda _: "998 rows" in driver.find_element(By.CSS_SELECTOR,
                "#grid .drg-selection-count").text)
            print("Extended virtual browser test passed: offscreen copy/paste, undo/redo, insertion, deletion, CSV export and reload")
        except Exception:
            if driver:
                try:
                    info=driver.execute_script("""
                      return {status:document.querySelector('#grid .drg-sync-status')?.textContent,
                        error:document.querySelector('#grid .drg-virtual-error')?.textContent,
                        toolbar:document.querySelector('#grid .drg-virtual-toolbar')?.textContent,
                        commit:document.querySelector('#commit-status')?.textContent,
                        viewport:document.querySelector('#viewport-status')?.textContent};
                    """)
                    print("Browser diagnostic:",info)
                except Exception:pass
            raise
        finally:
            if driver:driver.quit()
            process.terminate()
            try:out=process.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:
                process.kill()
                out=process.communicate()[0]
            print("Dash output:",out[-3000:])

if __name__=="__main__":
    test()
