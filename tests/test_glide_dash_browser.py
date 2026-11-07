"""Browser acceptance tests for the real Dash/Glide opt-in component.

Canvas-backed grids have no .rg-cell elements. These tests use Chrome's native
mouse/keyboard input against the canvas, and verify the Dash callback payload,
not a shadow DOM/proxy or a fixture write. Run after npm run build:js.
"""
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
PORT = 8077
URL = f"http://127.0.0.1:{PORT}"

COLUMN_WIDTHS = {
    "matrix": [("text",160),("amount",120),("custom",100),("percent",110),
               ("choice",145),("flag",85),("day",135),("clock",135),
               ("conditional",120),("fixed",120)],
    "source": [("label",180),("value",110)],
    "target": [("label",180),("value",110)],
    "paged": [("label",180),("value",110)],
    "readonly": [("label",180),("value",110)],
    "numeric": [("value",120),("other",120)],
}


class GlideDashBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.log=tempfile.TemporaryFile(mode="w+b")
        cls.server=subprocess.Popen(
            [sys.executable,"-m","tests.feature_matrix_browser_app"],
            cwd=ROOT,
            env={**os.environ,"GRID_MATRIX_BROWSER_PORT":str(PORT),"GRID_RENDERER":"glide"},
            stdout=cls.log,stderr=subprocess.STDOUT)
        cls.driver=None
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as response:
                        if response.status==200: break
                except Exception: time.sleep(.2)
            else: raise RuntimeError("Glide Dash feature fixture did not start")
            opts=webdriver.ChromeOptions()
            opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--window-size=1650,1100")
            opts.set_capability("unhandledPromptBehavior","accept")
            opts.set_capability("goog:loggingPrefs",{"browser":"ALL"})
            cls.driver=webdriver.Chrome(options=opts)
            cls.driver.execute_cdp_cmd("Browser.grantPermissions",{
                "origin":URL,
                "permissions":["clipboardReadWrite","clipboardSanitizedWrite"]})
            cls.waiter=WebDriverWait(cls.driver,10)
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if cls.driver: cls.driver.quit()
        if getattr(cls,"server",None):
            cls.server.terminate()
            try: cls.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.server.kill()
                cls.server.wait()
        if getattr(cls,"log",None):
            cls.log.seek(0,os.SEEK_END)
            size=cls.log.tell()
            cls.log.seek(max(0,size-3000))
            tail=cls.log.read().decode("utf-8",errors="replace")
            cls.log.close()
            if tail: print("Dash fixture log:",tail)

    def setUp(self):
        self.driver.get(URL)
        self.waiter.until(lambda d:d.find_elements(By.CSS_SELECTOR,"#matrix .drg-glide canvas"))
        self.waiter.until(lambda _:self.state("matrix").get("data"))

    def state(self,grid):
        try:
            return json.loads(self.driver.find_element(By.ID,grid+"-state").text)
        except (ValueError,IndexError):return {}

    def click(self,grid,column,row=0):
        layout=COLUMN_WIDTHS[grid]
        ix=next(i for i,(name,_) in enumerate(layout) if name==column)
        x=sum(w for _,w in layout[:ix])+layout[ix][1]/2
        y=32+row*27+13
        selector=f"#{grid} .drg-glide"
        pos=self.driver.execute_script("""
            const b=document.querySelector(arguments[0]).getBoundingClientRect();
            return {x:b.left+arguments[1],y:b.top+arguments[2]};
        """,selector,x,y)
        self.driver.execute_cdp_cmd("Input.dispatchMouseEvent",{
            "type":"mousePressed","x":pos["x"],"y":pos["y"],
            "button":"left","clickCount":1})
        self.driver.execute_cdp_cmd("Input.dispatchMouseEvent",{
            "type":"mouseReleased","x":pos["x"],"y":pos["y"],
            "button":"left","clickCount":1})
        return pos

    def type(self,text):
        for ch in text:
            ActionChains(self.driver).send_keys(ch).perform()

    def chord(self,*keys):
        seq=ActionChains(self.driver)
        for key in (Keys.CONTROL,Keys.SHIFT):
            if key in keys:seq.key_down(key)
        for key in keys:
            if key not in (Keys.CONTROL,Keys.SHIFT):seq.send_keys(key)
        for key in (Keys.SHIFT,Keys.CONTROL):
            if key in keys:seq.key_up(key)
        seq.perform()

    def changed(self,grid,row,column,value):
        def valid(_):
            rows=self.state(grid).get("data")
            return isinstance(rows,list) and len(rows)>row and rows[row][column]==value
        self.waiter.until(valid)

    def synthetic_clipboard(self,grid,kind,text="",html=None):
        return self.driver.execute_script("""
            const target=document.querySelector(arguments[0]+" .drg-glide canvas");
            const dt=new DataTransfer();
            dt.setData("text/plain",arguments[2]);
            if(arguments[3]!==null)dt.setData("text/html",arguments[3]);
            const event=new ClipboardEvent(arguments[1],{
              bubbles:true,cancelable:true,clipboardData:dt});
            target.dispatchEvent(event);
            return {prevented:event.defaultPrevented,text:dt.getData("text/plain")};
        """,f"#{grid}",kind,text,html)

    def test_01_canvas_mount_and_python_state(self):
        self.assertEqual(len(self.driver.find_elements(
            By.CSS_SELECTOR,"#matrix .drg-glide canvas"))>0,True)
        self.assertEqual(self.state("matrix")["data"][0][0],"Alpha")
        self.assertTrue(self.driver.find_elements(
            By.CSS_SELECTOR,"#review-virtual .rg-cell"),
            "Server virtualisation intentionally keeps existing ReactGrid")

    def test_02_click_updates_selected_cell(self):
        self.click("matrix","text")
        self.waiter.until(lambda _:self.state("matrix").get("selectedCell")==
            {"rowId":"r1","columnId":"text"})

    def test_03_type_directly_into_focused_text_cell(self):
        self.click("matrix","text")
        self.type("Edited")
        self.chord(Keys.ENTER)
        self.changed("matrix",0,0,"Edited")

    def test_04_type_number_and_commit(self):
        self.click("matrix","amount",1)
        self.type("31.25")
        self.chord(Keys.ENTER)
        self.changed("matrix",1,1,31.25)

    def test_05_numeric_locked_cell_rejects_edit(self):
        self.click("matrix","amount",0)
        self.type("99")
        self.chord(Keys.ENTER)
        self.assertEqual(self.state("matrix")["data"][0][1],10.5)

    def test_06_percent_entry(self):
        self.click("matrix","percent",0)
        self.type("37")
        self.chord(Keys.ENTER)
        self.changed("matrix",0,3,0.37)

    def test_07_checkbox_click(self):
        self.click("matrix","flag",0)
        self.changed("matrix",0,5,False)

    def test_08_dropdown_typed_label(self):
        self.click("matrix","choice",0)
        self.type("Finished")
        self.chord(Keys.ENTER)
        self.changed("matrix",0,4,"closed")

    def test_09_date_typed_iso(self):
        self.click("matrix","day",0)
        self.type("2026-11-14")
        self.chord(Keys.ENTER)
        self.changed("matrix",0,6,"2026-11-14")

    def test_10_time_typed_HH_MM(self):
        self.click("matrix","clock",0)
        self.type("15:45")
        self.chord(Keys.ENTER)
        self.waiter.until(lambda _:"15:45" in str(self.state("matrix")["data"][0][7]))

    def test_11_paste_Excel_tsv_round_trip(self):
        self.click("target","label")
        result=self.synthetic_clipboard("target","paste",'Pasted A\t12.5\nPasted B\t9')
        self.assertTrue(result["prevented"])
        self.changed("target",0,0,"Pasted A")
        self.changed("target",1,0,"Pasted B")
        self.changed("target",0,1,12.5)

    def test_12_undo_redo(self):
        self.click("target","label",0)
        self.type("Undo me")
        self.chord(Keys.ENTER)
        self.changed("target",0,0,"Undo me")
        self.chord(Keys.CONTROL,"z")
        self.changed("target",0,0,"Target 1")
        self.chord(Keys.CONTROL,"y")
        self.changed("target",0,0,"Undo me")

    def test_13_keyboard_arrow_focus(self):
        self.click("target","label",0)
        self.chord(Keys.ARROW_RIGHT)
        self.waiter.until(lambda _:self.state("target").get("selectedCell")==
            {"rowId":"target-1","columnId":"value"})

    def test_14_ctrl_a_copy(self):
        self.click("source","label",0)
        self.chord(Keys.CONTROL,"a")
        copied=self.synthetic_clipboard("source","copy")
        self.assertTrue(copied["prevented"])
        self.assertIn('A "quoted"',copied["text"])

    def test_15_paged_grid_preserves_metadata(self):
        self.click("paged","label",0)
        self.assertEqual(self.state("paged")["selectedCell"],
                         {"rowId":"p0","columnId":"label"})
        self.driver.find_element(By.CSS_SELECTOR,"#paged button:nth-last-child(1)").click()
        self.waiter.until(lambda _: "Rows 5-8" in
            self.driver.find_element(By.ID,"paged").text)

    def test_16_readonly_cannot_change(self):
        self.click("readonly","label",0)
        self.type("Bad")
        self.chord(Keys.ENTER)
        self.assertEqual(self.state("readonly")["data"][0][0],"Protected")

    def test_17_numpy_data_edit_uses_Dash_callback(self):
        self.click("numeric","value",0)
        self.type("9.5")
        self.chord(Keys.ENTER)
        self.waiter.until(lambda _: self.state("numeric").get("data") and
            float(self.state("numeric")["data"][0][0])==9.5)


if __name__=="__main__":
    unittest.main(verbosity=2)
