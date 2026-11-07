import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const observations = [];

for (const renderer of ["reactgrid", "glide", "revogrid"]) {
  test(renderer + ": mounts against the same numeric fixture and can jump", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/?renderer=" + renderer + "&rows=100000&cols=12&mode=numeric");
    await expect(page.getByTestId("status")).toContainText("ready", { timeout: 30000 });
    const snapshot = await page.evaluate(() => window.__bakeoff.snapshot());
    expect(snapshot.rows).toBe(100_000);
    expect(snapshot.cols).toBe(12);
    expect(snapshot.firstReadyMs).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__bakeoff.jump(50_000));
    if (renderer === "reactgrid") {
      await expect.poll(async () => {
        const range = await page.locator(".reactgrid-window").textContent();
        const match = /Rows (\d+) to (\d+)/.exec(range);
        return Boolean(match && Number(match[1]) <= 50_000 &&
          Number(match[2]) >= 50_000);
      }).toBe(true);
    }
    // Independent read assertions verify the data model, not the library's pixels.
    const value = await page.evaluate(() => window.__bakeoff.read(50_000, 0));
    expect(value).toBe(500.01);
    observations.push({renderer,case:"numeric mount",result:"pass",initialMs:snapshot.firstReadyMs,
      sourceMs:snapshot.sourcePreparationMs ?? 0});
  });

  test(renderer + ": observe actual keyboard entry and clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?renderer=" + renderer + "&rows=300&cols=8&mode=mixed");
    await expect(page.getByTestId("status")).toContainText("ready", {timeout:30000});
    // Click in the first visible data cell. Do NOT call fixture.write or a
    // grid-internal edit method: this probes genuine keyboard-first behaviour.
    const stage = await page.getByTestId("grid-stage").boundingBox();
    expect(stage).toBeTruthy();
    await page.mouse.click(stage.x + 83, stage.y + 77);
    await page.keyboard.type("Probe", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(180);
    const changed = await page.evaluate(() => window.__bakeoff.edits());
    const typed = changed.some(e => e.rowId === "r-0" &&
      e.columnId === "label" && e.value === "Probe");
    // These are observations, not baked-in assumptions about library parity.
    let clipboard = "";
    let clipboardError = "";
    try {
      await page.mouse.click(stage.x + 83, stage.y + 77);
      await page.keyboard.press("ControlOrMeta+c");
      clipboard = await page.evaluate(() => navigator.clipboard.readText());
    } catch (error) { clipboardError = String(error); }
    observations.push({renderer,case:"mixed keyboard and copy",
      typedFirstCell:typed, clipboardContainsRow:clipboard.includes("Probe") ||
        clipboard.includes("Row 0"), clipboardError, edits:changed});
    await page.screenshot({path:"test-results/"+renderer+"-mixed.png",fullPage:false});
    console.log("OBSERVATION " + JSON.stringify(observations.at(-1)));
  });
}

test.afterAll(() => {
  mkdirSync("test-results", {recursive:true});
  writeFileSync(join("test-results","feature-observations.json"),
    JSON.stringify(observations,null,2));
});
