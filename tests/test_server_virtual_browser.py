"""Chrome smoke test for scroll-driven, bounded, server-backed row requests."""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8061
URL = f"http://127.0.0.1:{PORT}"


def run_test():
    process = subprocess.Popen(
        [sys.executable, "-m", "tests.server_virtual_browser_app"],
        cwd=ROOT,
        env={**os.environ, "VIRTUAL_BROWSER_PORT":str(PORT)},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    driver = None
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen(URL,timeout=1) as result:
                    if result.status == 200: break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError("Server-backed grid app failed to start")

        opts=webdriver.ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--window-size=1300,900")
        driver=webdriver.Chrome(options=opts)
        wait=WebDriverWait(driver,20)
        driver.get(URL)

        wait.until(lambda _: "Fetched 0:120" in driver.find_element(By.ID,"requested-rows").text)
        wait.until(lambda _: driver.find_elements(By.CSS_SELECTOR, "#grid .rg-cell") and
                   "Row 0" in driver.find_element(By.ID,"grid").text)
        assert driver.find_element(By.ID,"grid").get_attribute("innerText").count("Row ") <= 130

        def scroll_to(pos):
            driver.execute_script(
                """const view=document.querySelector('#grid .drg-virtual-viewport');
                view.scrollTop=arguments[0];
                view.dispatchEvent(new Event('scroll', {bubbles:true}));""", pos)

        scroll_to(1_250_000)
        wait.until(lambda _: "Row 50000" in driver.find_element(By.ID,"grid").text)
        loaded_text=driver.find_element(By.ID,"requested-rows").text
        assert "Fetched " in loaded_text
        assert "(120 rows)" in loaded_text, loaded_text
        assert len(driver.find_elements(By.CSS_SELECTOR, "#grid .rg-cell")) < 1000

        scroll_to(2_400_000)
        wait.until(lambda _: "Row 96000" in driver.find_element(By.ID,"grid").text)
        assert len(driver.find_elements(By.CSS_SELECTOR, "#grid .rg-cell")) < 1000

        scroll_to(0)
        wait.until(lambda _: "Row 0" in driver.find_element(By.ID,"grid").text)
        assert "Row 50000" not in driver.find_element(By.ID,"grid").text

        # Closing an untouched search must restore the grid keyboard target.
        cells=driver.find_elements(By.CSS_SELECTOR,"#grid .rg-cell.rg-col-name")
        cells[-1].click()
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("f").key_up(Keys.CONTROL).perform()
        close_input=wait.until(lambda _:driver.find_element(
            By.CSS_SELECTOR,'#grid .drg-find input[type="search"]'))
        close_input.send_keys(Keys.ESCAPE)
        wait.until(lambda _:not driver.find_elements(By.CSS_SELECTOR,"#grid .drg-find"))
        assert "rg-hidden-element" in (driver.switch_to.active_element.get_attribute("class") or "")

        # Ctrl+F must find cells not present in the currently loaded window.
        cells=driver.find_elements(By.CSS_SELECTOR,"#grid .rg-cell.rg-col-name")
        assert len(cells)>1
        cells[-1].click()
        # A global selection must not remain active after Find jumps to a
        # single offscreen match; Ctrl+D would otherwise edit the old range.
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("a").key_up(Keys.CONTROL).perform()
        wait.until(lambda _:"100,000 rows selected" in driver.find_element(
            By.CSS_SELECTOR,"#grid .drg-selection-count").text)
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("f").key_up(Keys.CONTROL).perform()
        field=wait.until(lambda _:driver.find_element(
            By.CSS_SELECTOR,'#grid .drg-find input[type="search"]'))
        field.send_keys("Row 99999")
        field.send_keys(Keys.ENTER)
        wait.until(lambda _:"Row 100000" in driver.find_element(
            By.CSS_SELECTOR,"#grid .drg-find-status").text or
            "Row 99999" in driver.find_element(By.ID,"grid").text)
        wait.until(lambda _:"Row 99999" in driver.find_element(By.ID,"grid").text)
        wait.until(lambda _:len(driver.find_elements(
            By.CSS_SELECTOR,"#grid .rg-find-match"))>0)
        wait.until(lambda _:"1 rows selected" in driver.find_element(
            By.CSS_SELECTOR,"#grid .drg-selection-count").text)
        assert driver.find_element(By.CSS_SELECTOR,
            '#grid .drg-virtual-toolbar input[type="number"]').get_attribute("value")=="100000"
        assert len(driver.find_elements(By.CSS_SELECTOR,"#grid .rg-cell"))<1000

        # Changing the query must invalidate the cursor and jump back to top.
        field.clear()
        field.send_keys("Row 0")
        field.send_keys(Keys.ENTER)
        wait.until(lambda _:"Row 1, Name" in driver.find_element(
            By.CSS_SELECTOR,"#grid .drg-find-status").text)
        wait.until(lambda _:"Row 0" in driver.find_element(By.ID,"grid").text)
        field.send_keys(Keys.ESCAPE)
        wait.until(lambda _:not driver.find_elements(By.CSS_SELECTOR,"#grid .drg-find"))
        print("Server virtualization browser test passed: 100k rows, native scroll, bounded fetch/render and offscreen Ctrl+F")
    except Exception:
        if driver:
            print("DOM for diagnosis:",driver.page_source[-12000:])
        raise
    finally:
        if driver: driver.quit()
        process.terminate()
        try:
            output=process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            output=process.communicate()[0]
        print("Server output:",output[-4000:])

if __name__=="__main__":
    run_test()
