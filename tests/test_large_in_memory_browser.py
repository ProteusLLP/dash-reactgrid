"""Chrome regression for 22,050-cell in-memory edits across page boundaries."""
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
PORT=8071
URL=f"http://127.0.0.1:{PORT}"

def run():
    with tempfile.TemporaryFile(mode="w+b") as log:
        proc=subprocess.Popen(
            [sys.executable,"-m","tests.large_in_memory_browser_app"],
            cwd=ROOT,env={**os.environ,"GRID_LARGE_MEMORY_PORT":str(PORT)},
            stdout=log,stderr=subprocess.STDOUT)
        driver=None
        try:
            for _ in range(120):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as response:
                        if response.status==200:break
                except Exception:time.sleep(.25)
            else:raise RuntimeError("Large-grid fixture failed to start")
            opts=webdriver.ChromeOptions()
            opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--window-size=1400,900")
            driver=webdriver.Chrome(options=opts)
            wait=WebDriverWait(driver,90)
            driver.get(URL)

            def state():
                try:
                    return json.loads(driver.find_element(By.ID,"large-summary").text)
                except (ValueError,KeyError):
                    return {}
            def chord(*keys):
                chain=ActionChains(driver)
                for modifier in (Keys.CONTROL,Keys.SHIFT):
                    if modifier in keys:chain.key_down(modifier)
                for key in keys:
                    if key not in (Keys.CONTROL,Keys.SHIFT):
                        chain.send_keys(key)
                for modifier in (Keys.SHIFT,Keys.CONTROL):
                    if modifier in keys:chain.key_up(modifier)
                chain.perform()
            def focus_first():
                wait.until(lambda _:driver.find_elements(
                    By.CSS_SELECTOR,"#large-grid .rg-cell.rg-col-label"))[0].click()

            wait.until(lambda _:state().get("count")==22050)
            assert len(driver.find_elements(By.CSS_SELECTOR,"#large-grid .rg-cell"))<150

            focus_first()
            chord(Keys.CONTROL,Keys.SHIFT,Keys.ARROW_DOWN)
            chord(Keys.CONTROL,"d")
            wait.until(lambda _:state().get("last",[])[0]=="Row 0")
            assert state()["middle"][0]=="Row 0"
            assert state()["last"][1]==22049
            chord(Keys.CONTROL,"z")
            wait.until(lambda _:state().get("last",[])[0]=="Row 22049")

            # The same range can be filled with the editor's new value.
            focus_first()
            chord(Keys.CONTROL,Keys.SHIFT,Keys.ARROW_DOWN)
            ActionChains(driver).send_keys("X").perform()
            wait.until(lambda _:driver.execute_script("""
                const e=document.activeElement;
                return e?.tagName==='INPUT' && !e.classList.contains('rg-hidden-element');
            """))
            chord(Keys.SHIFT,Keys.ENTER)
            wait.until(lambda _:state().get("last",[])[0]=="X")
            assert state()["middle"][0]=="X"
            chord(Keys.CONTROL,"z")
            wait.until(lambda _:state().get("last",[])[0]=="Row 22049")

            focus_first()
            chord(Keys.CONTROL,Keys.SHIFT,Keys.ARROW_DOWN)
            chord(Keys.DELETE)
            wait.until(lambda _:state().get("last",[])[0]=="")
            assert state()["middle"][0]==""
            chord(Keys.CONTROL,"z")
            wait.until(lambda _:state().get("last",[])[0]=="Row 22049")
            print("Large in-memory Chrome test passed: 22,050-cell fill, multi-edit, clear and undo")
        finally:
            if driver:driver.quit()
            proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill();proc.wait()
            log.seek(0,os.SEEK_END)
            end=log.tell()
            log.seek(max(0,end-2500))
            print("Fixture log tail:",log.read().decode(errors="replace"))

if __name__=="__main__":run()
