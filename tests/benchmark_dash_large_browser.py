"""Browser-driven Dash large-grid measurements, not a microbenchmark.

Runs each case in a separate Dash process/Chrome session. Every result has
real HTTP initial layout size, wall-clock usable time, after-GC JS heap,
DOM nodes, optional scroll and typed edit latency, and Dash callback sizes.

Large unpaged 100k-row tables are intentionally not exercised: the code
creates ReactGrid-shaped objects for every cell and can exhaust CI RAM.
"""
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
PORT=8096
URL=f"http://127.0.0.1:{PORT}"
CASES=[
    ("normal","reactgrid",10000,12,False),
    ("normal","glide",10000,12,False),
    ("paged","reactgrid",100000,12,False),
    ("paged","glide",100000,12,False),
    ("paged","reactgrid",100000,12,True),
    ("paged","glide",100000,12,True),
    ("virtual","reactgrid",100000,12,True),
    ("virtual","glide",100000,12,True), # actual renderer is ReactGrid fallback
    ("virtual","reactgrid",1000000,12,True), # CSS scroll-height cap exercised
]
def bytes_read(url):
    with urllib.request.urlopen(url,timeout=45) as resp:
        return len(resp.read())

INJECT=r"""
window.__benchNet=[];
const originalFetch=window.fetch;
window.fetch=async function(...args){
  const t=performance.now();
  const res=await originalFetch.apply(this,args);
  const url=String(args[0]?.url??args[0]);
  if(url.includes('_dash-update-component')){
    const b=args[1]?.body;
    const size=typeof b==='string'?b.length:0;
    res.clone().text().then(txt=>window.__benchNet.push({
      requestBytes:size,responseBytes:txt.length,
      latencyMs:Math.round(performance.now()-t),
    })).catch(()=>{});
  }
  return res;
};
"""

def browser_metrics(driver):
    driver.execute_cdp_cmd("HeapProfiler.collectGarbage",{})
    metrics=driver.execute_cdp_cmd("Performance.getMetrics",{})["metrics"]
    m={x["name"]:x["value"] for x in metrics}
    more=driver.execute_script("""
      const root=document.querySelector('#grid');
      return {domNodes:document.querySelectorAll('*').length,
        gridNodes:root?root.querySelectorAll('*').length:0,
        reactgridCells:root?.querySelectorAll('.rg-cell').length??0,
        glideCanvas:root?.querySelectorAll('canvas').length??0,
        network:window.__benchNet??[],
        memoryJS:performance.memory?.usedJSHeapSize??null,
        totalHeight:root?.scrollHeight??null};
    """)
    return {**{k:round(m.get(k,0),3) for k in
                ("Nodes","LayoutCount","RecalcStyleCount")},
      "heapMiB":round(m.get("JSHeapUsedSize",0)/1048576,2),
      **more}

def case_run(mode,renderer,n,w,sparse):
    result={"mode":mode,"requestedRenderer":renderer,
      "effectiveRenderer":"reactgrid" if mode=="virtual" else renderer,
      "rows":n,"cols":w,"sparse":sparse,"cells":n*w,
      "initialData":"numpy-packed" if mode!="virtual" else "server-window"}
    logfile=tempfile.TemporaryFile(mode="w+b")
    env={**os.environ,"LOAD_GRID_MODE":mode,"LOAD_GRID_RENDERER":renderer,
      "LOAD_GRID_ROWS":str(n),"LOAD_GRID_COLS":str(w),"LOAD_GRID_PORT":str(PORT),
      "LOAD_GRID_SPARSE":"1" if sparse else "0"}
    proc=subprocess.Popen([sys.executable,"-m","tests.benchmark_dash_large_app"],
      cwd=ROOT,env=env,stdout=logfile,stderr=subprocess.STDOUT)
    driver=None
    try:
      for _ in range(150):
        try:
          with urllib.request.urlopen(URL,timeout=2) as r:
            if r.status==200: break
        except Exception: time.sleep(.2)
      else: raise TimeoutError("Dash server start")
      result["layoutBytes"]=bytes_read(URL+"/_dash-layout")
      options=webdriver.ChromeOptions()
      for opt in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
                  "--enable-precise-memory-info","--window-size=1536,900"):
        options.add_argument(opt)
      options.page_load_strategy="eager"
      driver=webdriver.Chrome(options=options)
      driver.set_page_load_timeout(90)
      driver.execute_cdp_cmd("Performance.enable",{})
      driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":INJECT})
      t0=time.monotonic()
      driver.get(URL)
      wait=WebDriverWait(driver,90)
      if mode=="virtual":
        wait.until(lambda d:"window=0:" in
            d.find_element(By.ID,"window-status").text)
        wait.until(lambda d:len(d.find_elements(
            By.CSS_SELECTOR,"#grid .rg-col-c0.rg-cell"))>0 and
            not d.find_elements(By.CSS_SELECTOR,"#grid .rg-virtual-loading"))
      elif renderer=="glide":
        wait.until(lambda d:d.find_elements(By.CSS_SELECTOR,"#grid .drg-glide canvas"))
      else:
        wait.until(lambda d:len(d.find_elements(
            By.CSS_SELECTOR,"#grid .rg-col-c0.rg-cell"))>0)
      driver.execute_script("return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
      result["usableLoadMs"]=round((time.monotonic()-t0)*1000,1)
      result["initial"]=browser_metrics(driver)
      if mode=="virtual":
        scroll=driver.execute_script("""
          const e=document.querySelector('#grid .drg-virtual-viewport');
          const max=e.scrollHeight-e.clientHeight;
          e.scrollTop=max*0.9;
          e.dispatchEvent(new Event('scroll',{bubbles:true}));
          return {max,position:e.scrollTop};
        """)
        tscroll=time.monotonic()
        wait.until(lambda d:
          (txt:=d.find_element(By.ID,"window-status").text).startswith("window=")
          and int(txt.split("=")[1].split(":")[0])>n//2
          and not d.find_elements(By.CSS_SELECTOR,"#grid .rg-virtual-loading"))
        result["scrollMs"]=round((time.monotonic()-tscroll)*1000,1)
        result["scrollPosition"]=scroll
        result["afterScroll"]=browser_metrics(driver)
      # Confirm one small edit reaches Python through an actual Dash callback.
      # For virtual mode scroll back to the top, so the first row is loaded.
      if mode=="virtual":
        driver.execute_script("""
          const e=document.querySelector('#grid .drg-virtual-viewport');
          e.scrollTop=0;e.dispatchEvent(new Event('scroll',{bubbles:true}));
        """)
        # The first window may be in the browser cache. Returning to it
        # does not necessarily invoke a new Dash callback, so wait for the
        # displayed first row rather than a new window-status update.
        wait.until(lambda d:(
          d.execute_script("return document.querySelector('#grid .drg-virtual-viewport').scrollTop")<2
          and any(cell.text.strip() in ("0","0.00")
                  for cell in d.find_elements(By.CSS_SELECTOR,
                      "#grid .rg-col-c0.rg-cell")[:4])
          and not d.find_elements(By.CSS_SELECTOR,"#grid .rg-virtual-loading")))
      target=driver.find_elements(By.CSS_SELECTOR,"#grid .rg-col-c0.rg-cell")
      if renderer=="glide" and mode!="virtual":
        canvas=driver.find_element(By.CSS_SELECTOR,"#grid .drg-glide")
        canvas.click()
        driver.execute_script("document.querySelector('#grid .drg-glide').scrollIntoView()")
        # Use existing first accessible cell to set keyboard selection.
        try:
          accessible=driver.find_element(By.CSS_SELECTOR,
            '#grid [data-testid="glide-cell-0-1"]')
          accessible.click()
        except Exception: pass
      elif target:
        target[0].click()
      # Use single edit '9' which is independent of keyboard input pacing.
      # A ReactGrid numeric first row initially reads 0.
      tedit=time.monotonic()
      ActionChains(driver).send_keys("9").perform()
      ActionChains(driver).send_keys(Keys.ENTER).perform()
      try:
        WebDriverWait(driver,18).until(lambda d:"edit-seq=" in
          d.find_element(By.ID,"edit-status").text)
        result["editCallbackMs"]=round((time.monotonic()-tedit)*1000,1)
        result["editResult"]=driver.find_element(By.ID,"edit-status").text
      except Exception as exc:
        result["editError"]=str(exc)[:160]
      result["postEdit"]=browser_metrics(driver)
    except Exception as exc:
      result["error"]=f"{type(exc).__name__}: {exc}"[:700]
    finally:
      if driver:
        try: driver.quit()
        except Exception: pass
      proc.terminate()
      try:proc.wait(timeout=6)
      except subprocess.TimeoutExpired:proc.kill();proc.wait()
      logfile.seek(0,os.SEEK_END)
      size=logfile.tell();logfile.seek(max(0,size-3000))
      result["serverLogTail"]=logfile.read().decode(errors="replace")[-1100:] if "error" in result else None
      logfile.close()
    return result

def main():
    selected=set(sys.argv[1:]) if len(sys.argv)>1 else None
    results=[]
    for mode,renderer,n,w,sparse in CASES:
      label=f"{mode}-{renderer}-{'sparse' if sparse else 'full'}"
      if selected and label not in selected: continue
      print("CASE",label,n,w,flush=True)
      result=case_run(mode,renderer,n,w,sparse)
      results.append(result)
      print("RESULT",json.dumps(result,ensure_ascii=False),flush=True)
    Path("dash-large-results.json").write_text(json.dumps(results,indent=2)+"\n")
    return 0 if all("error" not in r for r in results) else 1

if __name__=="__main__":
    raise SystemExit(main())
