/*
 * Reproducible synthetic benchmark; intentionally not a latency gate.
 * Run: node --experimental-detect-module scripts/benchmark-large-grid.mjs
 */
import { performance } from "node:perf_hooks";
import { applyChanges } from "../src/lib/model.js";
import { buildGridRows, compileGridColumns, pageBounds } from "../src/lib/gridRows.js";

const size = 100_000;
const width = 20;
const columns = Array.from({ length: width }, (_, i) => ({
  columnId: "c" + i, title: "C" + i, type: "number",
}));
const table = {
  data: Array.from({ length: size }, (_, i) =>
    Array.from({ length: width }, (_, j) => i * width + j)),
  rowIds: Array.from({ length: size }, (_, i) => "row-" + i),
};
const change = [{ rowId: "row-95000", columnId: "c10", value: -1 }];

// The previous implementation copied every row and looked up row ids linearly.
const previousEdit = () => {
  const data = table.data.map((row) => row.slice());
  const ids = table.rowIds.slice();
  data[ids.indexOf("row-95000")][10] = -1;
  return data;
};
const currentEdit = () => applyChanges(table, change, { columns });

const median = (times) => {
  const sorted = times.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const measure = (fn) => {
  for (let i = 0; i < 3; i++) fn();
  const results = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    fn();
    results.push(performance.now() - start);
  }
  return median(results);
};

const oldMs = measure(previousEdit);
const newMs = measure(currentEdit);
const next = currentEdit();
if (next.data[95_000][10] !== -1 || table.data[95_000][10] === -1 ||
    next.data[0] !== table.data[0]) throw Error("copy-on-write correctness failed");

const descriptors = compileGridColumns(columns, columns, "en-GB");
const bounds = pageBounds(size, 250, 380);
const renderMs = measure(() => buildGridRows({
  columns, descriptors, allColumns: columns,
  data: table.data.slice(bounds.start, bounds.end),
  rowIds: table.rowIds.slice(bounds.start, bounds.end),
  readOnly: false, locked: new Set(), showGhost: false,
}));
console.log("Synthetic table: " + size + " rows x " + width + " columns (" +
  (size * width).toLocaleString("en-GB") + " cells)");
console.log("Median single edit, original deep copy: " + oldMs.toFixed(2) + " ms");
console.log("Median single edit, copy-on-write: " + newMs.toFixed(2) + " ms");
console.log("Speed-up on this runner: " + (oldMs / newMs).toFixed(1) + "x");
console.log("Median render of a 250-row page: " + renderMs.toFixed(2) + " ms");
console.log("Rows supplied to ReactGrid: " + (bounds.end - bounds.start) + " / " + size);
