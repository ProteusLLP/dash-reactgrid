"""End-to-end Chrome test for server-virtual structural and range operations."""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.fixtures.sqlite_virtual_backend import VirtualGridStore
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

            def grid_key(key,code,shift=False):
                return driver.execute_script("""
                    const view=document.querySelector('#grid .drg-virtual-viewport');
                    const event=new KeyboardEvent('keydown',{
                      key:arguments[0],code:arguments[1],ctrlKey:true,
                      shiftKey:arguments[2],bubbles:true,cancelable:true});
                    view.dispatchEvent(event);
                    return event.defaultPrevented;
                """,key,code,shift)

            def select(start,end):
                # Scroll and extend a native cell selection with Shift+Down.
                assert 1 <= start <= end <= store.row_count()
                driver.execute_script("""
                    const view=document.querySelector('#grid .drg-virtual-viewport');
                    view.scrollTop=Math.max(0,arguments[0]-5)*25;
                    view.dispatchEvent(new Event('scroll',{bubbles:true}));
                """,start)
                current=store.read_range(start-1,start)["data"][0][0]
                previous=(store.read_range(start-2,start-1)["data"][0][0]
                          if start>1 else None)
                def focus(_):
                    # Resolve the DOM target in one browser round-trip. The
                    # virtual window can remount while its fetch completes.
                    cell=driver.execute_script("""
                        const cells=[...document.querySelectorAll(
                          '#grid .rg-cell.rg-col-name')];
                        const current=arguments[0],previous=arguments[1];
                        if(current!==null)
                          return cells.find(c=>c.textContent.trim()===String(current))||null;
                        const i=cells.findIndex(c=>
                          c.textContent.trim()===String(previous));
                        return i>=0 ? cells[i+1]||null : null;
                    """,current,previous)
                    if cell is None:
                        return False
                    try:
                        cell.click()
                        return True
                    except StaleElementReferenceException:
                        return False
                wait.until(focus)
                for _ in range(end-start):
                    ActionChains(driver).key_down(Keys.SHIFT).send_keys(
                        Keys.ARROW_DOWN).key_up(Keys.SHIFT).perform()
                # Extend from the first column to the last, matching the
                # original all-column row-range selection using native keys.
                ActionChains(driver).key_down(Keys.SHIFT).send_keys(
                    Keys.ARROW_RIGHT).key_up(Keys.SHIFT).perform()

            def synced():
                return "All edits acknowledged" in driver.find_element(
                    By.CSS_SELECTOR,"#grid .drg-sync-status").text
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

            # No action toolbar, range inputs, or CSV link are rendered.
            assert not driver.find_elements(By.CSS_SELECTOR,"#grid .drg-virtual-toolbar")
            assert not driver.find_elements(By.CSS_SELECTOR,"#grid input[type=number]")
            assert not driver.find_elements(By.CSS_SELECTOR,"#grid a[download]")

            # Scroll to an unloaded row, select it natively, then Ctrl+C.
            select(501,503)
            wait.until(lambda _:"Copy prepared 500:503" in
                driver.find_element(By.ID,"range-status").text)
            # The renderer may replace its focused cell while publishing the
            # absolute range. Focus the keyboard-accessible viewport without
            # changing the selection before the real Ctrl+C gesture.
            driver.execute_script("""
                document.querySelector('#grid .drg-virtual-viewport').focus({
                  preventScroll:true});
            """)
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(
                "c").key_up(Keys.CONTROL).perform()
            wait.until(lambda _:clipboard().replace("\r\n","\n").rstrip("\n")==
                "Row 500\t500\nRow 501\t501\nRow 502\t502")

            # Multi-row paste targets row indices outside the DOM; apply the
            # complete operation atomically in the backend.
            select(501,501)
            paste('Pasted 500\t5000\n"Pasted\t501"\t5001')
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Pasted 500",5000],["Pasted\t501",5001],
            ])
            wait.until(lambda _: synced())
            assert grid_key("z","KeyZ")
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Row 500",500],["Row 501",501],
            ])
            wait.until(lambda _: synced())
            assert grid_key("y","KeyY")
            wait.until(lambda _: store.read_range(500,502)["data"]==[
                ["Pasted 500",5000],["Pasted\t501",5001],
            ])
            wait.until(lambda _: synced())

            # Insert at an absolute server row index even though the selected
            # row is not loaded in ReactGrid.
            select(501,501)
            assert grid_key("+","Equal",True)
            wait.until(lambda _: store.row_count()==1001)
            wait.until(lambda _: synced())
            snapshot=store.read_range(500,503)
            assert snapshot["data"][:2]==[[None,None],["Pasted 500",5000]]
            inserted_id=snapshot["rowIds"][0]
            assert inserted_id.startswith("new-")

            # Deleting an unloaded interval shifts later rows and updates the
            # server-owned row count, without re-sending the table to Dash.
            select(501,503)
            # The confirmation dialog can interrupt the browser's script
            # return value despite the shortcut being handled.
            grid_key("-","Minus")
            driver.switch_to.alert.accept()
            wait.until(lambda _: store.row_count()==998)
            wait.until(lambda _: synced())
            assert grid_key("z","KeyZ")
            wait.until(lambda _: store.row_count()==1001)
            wait.until(lambda _: synced())
            assert store.read_range(500,501)["rowIds"]==[inserted_id]
            assert grid_key("y","KeyY")
            wait.until(lambda _: store.row_count()==998)
            wait.until(lambda _: synced())

            # The undo receipt stack is retained across a same-tab reload.
            # Undo/redo must still refer to the original server journal.
            driver.refresh()
            wait.until(lambda _: "998 rows" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            assert grid_key("z","KeyZ")
            wait.until(lambda _: store.row_count()==1001)
            wait.until(lambda _: synced())
            assert grid_key("y","KeyY")
            wait.until(lambda _: store.row_count()==998)
            wait.until(lambda _: synced())

            assert grid_key("a","KeyA")
            wait.until(lambda _: "998 rows selected" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            # CSV is still available through the hosting application's
            # endpoint, without displaying an export control inside the grid.
            query=urllib.parse.urlencode({
                "start":0,"end":998,"columnStart":0,"columnEnd":2,
                "columnIds":'["name","value"]',"datasetId":"virtual-rows-v1",
            })
            with urllib.request.urlopen(URL+"/export.csv?"+query,timeout=15) as export:
                document=export.read().decode()
            assert document.startswith("name,value\r\n")
            assert len(document.splitlines())==999, "Full-range CSV streaming must include all rows"
            assert "Pasted 500,5000" not in document, "The previously deleted range must stay deleted"

            driver.refresh()
            wait.until(lambda _: "998 rows" in driver.find_element(By.CSS_SELECTOR,
                "#grid .drg-selection-count").text)

            # Selecting the header must select every logical row, including
            # rows not loaded into ReactGrid's current viewport.
            previous_name=store.read_range(900,901)["data"][0][0]
            header=wait.until(lambda _: driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-header-cell"))[0]
            header.click()
            wait.until(lambda _: "998 rows selected" in driver.find_element(
                By.CSS_SELECTOR,"#grid .drg-selection-count").text)
            handled=driver.execute_script("""
              const viewport=document.querySelector('#grid .drg-virtual-viewport');
              const event=new KeyboardEvent('keydown',{
                key:'d',code:'KeyD',ctrlKey:true,bubbles:true,cancelable:true});
              viewport.dispatchEvent(event);
              return event.defaultPrevented;
            """)
            assert handled, "Ctrl+D must be intercepted for virtual whole-column fill"
            wait.until(lambda _: store.read_range(900,901)["data"][0][0]=="Row 0")
            wait.until(lambda _: synced())
            assert grid_key("z","KeyZ")
            wait.until(lambda _: store.read_range(900,901)["data"][0][0]==previous_name)
            wait.until(lambda _: synced())

            # Structural actions remain accessible by the native context menu.
            first=wait.until(lambda _:driver.find_elements(
                By.CSS_SELECTOR,"#grid .rg-cell.rg-col-name"))[0]
            ActionChains(driver).context_click(first).perform()
            for label in ("Insert row above","Append row","Delete selected rows"):
                wait.until(lambda _:next((el for el in driver.find_elements(
                    By.XPATH,f"//*[normalize-space(text())='{label}']")
                    if el.is_displayed()),None))

            print("Extended virtual browser test passed: offscreen range operations, whole-column fill and undo/redo")
        except Exception:
            if driver:
                try:
                    info=driver.execute_script("""
                      return {status:document.querySelector('#grid .drg-sync-status')?.textContent,
                        error:document.querySelector('#grid .drg-virtual-error')?.textContent,
                        selection:document.querySelector('#grid .drg-selection-count')?.textContent,
                        focused:document.activeElement?.outerHTML?.slice(0,300),
                        commit:document.querySelector('#commit-status')?.textContent,
                        viewport:document.querySelector('#viewport-status')?.textContent,
                        range:document.querySelector('#range-status')?.textContent};
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
