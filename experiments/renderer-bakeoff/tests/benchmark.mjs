// Standalone, repeatable Chromium benchmark; report results, never infer a
// speedup from one synthetic run on shared CI hardware.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 4179;
const origin = "http://127.0.0.1:" + PORT;
const server = spawn("npm", ["run", "dev", "--", "--port", String(PORT), "--strictPort"],
  {stdio: ["ignore", "pipe", "pipe"], env: process.env});
let output = "";
server.stdout.on("data", data => output += data);
server.stderr.on("data", data => output += data);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error("Vite exited: " + output);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await delay(200);
  }
  throw Error("Vite did not start: " + output);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({headless:true, args:["--no-sandbox"]});
  const results = [];
  for (const renderer of ["reactgrid", "glide", "revogrid"]) {
    for (const mode of ["numeric","mixed"]) {
      const page = await browser.newPage({viewport:{width:1450,height:940}});
      const errors = [];
      page.on("pageerror", err => errors.push(err.message));
      const rows = mode === "mixed" ? 50_000 : 100_000;
      const cols = mode === "mixed" ? 8 : 12;
      const start = performance.now();
      await page.goto(origin + "/?renderer=" + renderer + "&rows=" + rows +
        "&cols=" + cols + "&mode=" + mode, {waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => window.__bakeoff?.ready === true, {timeout:30000});
      const wallMs = performance.now() - start;
      const snapshot = await page.evaluate(() => window.__bakeoff.snapshot());
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const {metrics} = await cdp.send("Performance.getMetrics");
      const heapBytes = metrics.find(x => x.name === "JSHeapUsedSize")?.value ?? null;
      let domNodes = null;
      try { domNodes = (await cdp.send("Memory.getDOMCounters")).nodes; } catch {}
      const jumpStart = performance.now();
      await page.evaluate(row => window.__bakeoff.jump(row), Math.floor(rows / 2));
      // Dispatch-to-two-paints, not a measured time until all cells load.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
        () => requestAnimationFrame(resolve))));
      const jumpDispatchMs = performance.now() - jumpStart;
      results.push({renderer, mode, rows, cols,
        startupWallMs:+wallMs.toFixed(1),
        firstReadyMs:Math.round(snapshot.firstReadyMs),
        fixtureMs:+snapshot.initializationMs.toFixed(1),
        sourcePreparationMs:+(snapshot.sourcePreparationMs ?? 0).toFixed(1),
        heapMiB:heapBytes===null?null:+(heapBytes/1048576).toFixed(1),
        domNodes, jumpDispatchMs:+jumpDispatchMs.toFixed(1), errors});
      console.log(JSON.stringify(results.at(-1)));
      await cdp.detach();
      await page.close();
    }
  }
  mkdirSync("test-results", {recursive:true});
  writeFileSync("test-results/benchmark.json",JSON.stringify({
    disclaimer:"Single-run CI measurements; not comparative speedup estimates. ReactGrid uses a bounded 160-row engine window; RevoGrid materializes its row source; Glide reads cells lazily.",
    results,
  },null,2));
  const columns = ["renderer","mode","rows","cols","firstReadyMs","fixtureMs",
    "sourcePreparationMs","heapMiB","domNodes","jumpDispatchMs"];
  const markdown = ["# Experimental renderer measurements",
    "",
    "Single-run synthetic Chromium measurements. Results are not a statistically significant speed comparison. ReactGrid uses a bounded row window; RevoGrid constructs a complete row source; Glide accesses cells on demand.",
    "",
    "| "+columns.join(" | ")+" |",
    "| "+columns.map(()=> "---").join(" | ")+" |",
    ...results.map(r => "| "+columns.map(k => r[k] ?? "N/A").join(" | ")+" |"),
    "",
    "startupWallMs includes page navigation and JS transfer. firstReadyMs includes fixture and renderer loading. jumpDispatchMs measures command dispatch and two animation frames, not completion of a server fetch.",
    "",
    "Additional feature and keyboard results: feature-observations.json",
  ].join("\n");
  writeFileSync("test-results/benchmark.md",markdown);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
