"""End-to-end client-memory grid: DOM bound, scrolling, focus and editing."""
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
PORT=8078
URL=f"http://127.0.0.1:{PORT}"

def run():
    with tempfile.TemporaryFile(mode="w+b") as log:
        process=subprocess.Popen(
            [sys.executable,"-m","tests.client_virtual_browser_app"],cwd=ROOT,
            env={**os.environ,"GRID_CLIENT_VIRTUAL_PORT":str(PORT)},
            stdout=log,stderr=subprocess.STDOUT,
        )
        driver=None
        try:
            for _ in range(160):
                try:
                    with urllib.request.urlopen(URL,timeout=1) as response:
                        if response.status==200:break
                except Exception:time.sleep(.25)
            else:raise RuntimeError("Client virtual fixture failed to start")
            options=webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1400,900")
            driver=webdriver.Chrome(options=options)
            wait=WebDriverWait(driver,120)
            driver.get(URL)
            viewport="#client-grid .drg-virtual-viewport"
            cell="#client-grid .rg-cell.rg-col-0"
            wait.until(lambda _:len(driver.find_elements(By.CSS_SELECTOR,cell))>1)
            assert len(driver.find_elements(By.CSS_SELECTOR,"#client-grid .rg-cell"))<1800
            assert not driver.find_elements(By.CSS_SELECTOR,"#client-grid .drg-pager")

            driver.execute_script("""
                const viewport=document.querySelector(arguments[0]);
                viewport.scrollTop=800000;
                viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
            """,viewport)
            wait.until(lambda _:driver.execute_script("""
                const cells=[...document.querySelectorAll(arguments[0])];
                return cells.some(c=>Number(c.textContent.replaceAll(',',''))>100000);
            """,cell))
            assert len(driver.find_elements(By.CSS_SELECTOR,"#client-grid .rg-cell"))<1800

            driver.execute_script("""
                const viewport=document.querySelector(arguments[0]);
                viewport.scrollTop=0;
                viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
            """,viewport)
            wait.until(lambda _:driver.execute_script("""
                return [...document.querySelectorAll(arguments[0])]
                    .some(c=>c.textContent.trim()==='0');
            """,cell))
            first=driver.find_elements(By.CSS_SELECTOR,cell)[0]
            first.click()
            ActionChains(driver).send_keys("9").send_keys(Keys.ENTER).perform()
            wait.until(lambda _:driver.find_element(By.ID,"client-events").text.strip())
            event=json.loads(driver.find_element(By.ID,"client-events").text)
            assert any(edit.get("columnId")=="0" and edit.get("value")==9
                       for edit in event.get("edits",[])),event
            assert len(driver.find_elements(By.CSS_SELECTOR,"#client-grid .rg-cell"))<1800

            # Acknowledged edits must survive viewport eviction and remounting.
            # This catches a regression where the typed-array backing store is
            # not updated when ReactGrid discards its visible row components.
            driver.execute_script("""
                const viewport=document.querySelector(arguments[0]);
                viewport.scrollTop=800000;
                viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
            """,viewport)
            wait.until(lambda _:driver.execute_script("""
                return [...document.querySelectorAll(arguments[0])]
                    .some(c=>Number(c.textContent.replaceAll(',',''))>100000);
            """,cell))
            driver.execute_script("""
                const viewport=document.querySelector(arguments[0]);
                viewport.scrollTop=0;
                viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
            """,viewport)
            wait.until(lambda _:driver.execute_script("""
                return [...document.querySelectorAll(arguments[0])]
                    .some(c=>c.textContent.trim()==='9');
            """,cell))
            assert driver.find_elements(By.CSS_SELECTOR,cell)[0].text.strip() == "9", (
                "Edited first row was lost after scrolling out and back"
            )

            # Repeated distant scrolls must not accumulate DOM cells.
            for offset in (1800000, 100000, 2200000, 0):
                driver.execute_script("""
                    const viewport=document.querySelector(arguments[0]);
                    viewport.scrollTop=arguments[1];
                    viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
                """,viewport,offset)
                wait.until(lambda _:driver.execute_script("""
                    const viewport=document.querySelector(arguments[0]);
                    return Math.abs(viewport.scrollTop-arguments[1])<100;
                """,viewport,offset))
                wait.until(lambda _:len(driver.find_elements(
                    By.CSS_SELECTOR,"#client-grid .rg-cell"))<1800)
            wait.until(lambda _:driver.find_elements(By.CSS_SELECTOR,cell)
                       and driver.find_elements(By.CSS_SELECTOR,cell)[0].text.strip()=="9")
            print("Client virtual Chrome test passed: 100k rows, bounded DOM, repeated offscreen scroll, persistent sparse editing")
        finally:
            if driver:driver.quit()
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.seek(0,os.SEEK_END)
            end=log.tell()
            log.seek(max(0,end-2500))
            print("Fixture log tail:",log.read().decode(errors="replace"))

if __name__=="__main__":run()
