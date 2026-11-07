import { test } from "node:test";
import assert from "node:assert/strict";

import { compileGridColumns, buildGridRows, pageBounds, canPasteOnPage } from "../gridRows.js";
import { GHOST_ROW_ID } from "../model.js";

const columns = [
  { columnId: "name", title: "Name", type: "text" },
  { columnId: "balance", title: "Balance", type: "number", formatOptions: { maximumFractionDigits: 2 } },
  { columnId: "ratio", title: "Ratio", type: "percent" },
  { columnId: "status", title: "Status", type: "dropdown", values: ["open", "closed"] },
  { columnId: "valid", title: "Valid", type: "checkbox", editableWhen: [{ columnId: "status", in: ["open"] }] },
];
const ids = columns.map((c) => c.columnId);
const data = [
  ["Alice", 1234.5, 0.35, "open", true],
  ["Bob", 19.5, 0.1, "closed", false],
];
const rowIds = ["r1", "r2"];
const renders = compileGridColumns(columns, columns, "en-GB");
const render = (opts = {}) => buildGridRows({
  columns, descriptors: renders, allColumns: columns, data, rowIds, newRow: null,
  readOnly: false, locked: new Set(), styleHeader: { height: 30 },
  showGhost: false, openDropdown: null, ...opts,
});

test("a single formatter and option array are shared by every cell in each column", () => {
  const { rows } = render();
  assert.strictEqual(rows[1].cells[1].format, rows[2].cells[1].format);
  assert.strictEqual(rows[1].cells[2].format, rows[2].cells[2].format);
  assert.strictEqual(rows[1].cells[3].values, rows[2].cells[3].values);
  assert.equal(rows[1].cells[1].value, 1234.5);
  assert.equal(rows[1].cells[2].value, 0.35);
  assert.equal(rows[0].cells[0].text, "Name");
  assert.equal(rows[0].height, 30);
});

test("compiled editable rules and locked cells preserve per-cell editing state", () => {
  const { rows } = render({ locked: new Set(["r1\u0000balance"]) });
  assert.equal(rows[1].cells[1].nonEditable, true);
  assert.equal(rows[1].cells[4].nonEditable, false);
  assert.equal(rows[2].cells[4].nonEditable, true);
  assert.match(rows[2].cells[4].className, /rg-cell-na/);
  assert.equal(rows[1].cells[0].nonEditable, false);
});

test("hidden columns still reference the original data indices for values and rules", () => {
  const visible = [columns[0], columns[4]];
  const descriptors = compileGridColumns(visible, columns, "en-GB");
  const { rows } = render({ columns: visible, descriptors });
  assert.equal(rows[1].cells[1].checked, true);
  assert.equal(rows[1].cells[1].nonEditable, false);
  assert.equal(rows[2].cells[1].nonEditable, true);
});

test("only unchanged rows are reused, and opening a dropdown rebuilds just that row", () => {
  const first = render();
  const second = render({ previous: first.cache });
  assert.strictEqual(first.rows[1], second.rows[1]);
  assert.strictEqual(first.rows[2], second.rows[2]);
  const open = render({ previous: second.cache, openDropdown: { rowId: "r1", columnId: "status" } });
  assert.notStrictEqual(open.rows[1], second.rows[1]);
  assert.strictEqual(open.rows[2], second.rows[2]);
  assert.equal(open.rows[1].cells[3].isOpen, true);
  const changed = render({
    data: [data[0], ["Bob", 100, 0.1, "closed", false]],
    openDropdown: { rowId: "r1", columnId: "status" },
    previous: open.cache,
  });
  assert.strictEqual(changed.rows[1], open.rows[1]);
  assert.notStrictEqual(changed.rows[2], open.rows[2]);
});

test("extendable ghost is visible only on the final page and retains its edit rules", () => {
  const { rows } = render({ showGhost: true, newRow: { status: "closed" } });
  assert.equal(rows.at(-1).rowId, GHOST_ROW_ID);
  assert.match(rows.at(-1).cells[0].className, /rg-ghost/);
  assert.equal(rows.at(-1).cells[4].nonEditable, true);
  assert.equal(render({ showGhost: false }).rows.length, 3);
});

test("page bounds handle 100k rows, exact boundaries, empty tables, and invalid input", () => {
  assert.deepEqual(pageBounds(100_000, 250, 0), { page: 0, count: 400, start: 0, end: 250 });
  assert.deepEqual(pageBounds(100_000, 250, 399), { page: 399, count: 400, start: 99_750, end: 100_000 });
  assert.deepEqual(pageBounds(100_001, 250, 400), { page: 400, count: 401, start: 100_000, end: 100_001 });
  assert.deepEqual(pageBounds(100_000, 250, 999), { page: 399, count: 400, start: 99_750, end: 100_000 });
  assert.deepEqual(pageBounds(0, 250, -1), { page: 0, count: 1, start: 0, end: 0 });
  assert.deepEqual(pageBounds(10, null, 50), { page: 0, count: 1, start: 0, end: 10 });
  assert.equal(pageBounds(100, 250, NaN).page, 0);
});

test("a 100k-row source supplies only one page to ReactGrid's cell builder", () => {
  const big = Array.from({ length: 100_000 }, (_, i) => [String(i), i]);
  const bigIds = Array.from({ length: big.length }, (_, i) => "row-" + i);
  const twoCols = columns.slice(0, 2);
  const descriptor = compileGridColumns(twoCols, twoCols, "en-GB");
  const { start, end } = pageBounds(big.length, 250, 380);
  const built = buildGridRows({
    columns: twoCols, descriptors: descriptor, allColumns: twoCols,
    data: big.slice(start, end), rowIds: bigIds.slice(start, end),
    readOnly: false, locked: new Set(), showGhost: false,
  });
  assert.equal(built.rows.length, 251);
  assert.equal(built.rows[1].rowId, "row-95000");
  assert.equal(built.rows.at(-1).rowId, "row-95249");
});

test("pasting never writes onto the next hidden page", () => {
  const first = pageBounds(1000, 250, 0);
  assert.equal(canPasteOnPage(249, first, 250), true);
  assert.equal(canPasteOnPage(250, first, 250), false);
  const last = pageBounds(1001, 250, 4);
  assert.equal(canPasteOnPage(1001, last, 250), true, "extendable tables can paste new rows on the last page");
  assert.equal(canPasteOnPage(9999, first, null), true, "unpaged tables retain normal paste behaviour");
});

test("column header tooltip is opt-in and unchanged when columns are hidden", () => {
  const first = { ...columns[0], tooltip: "Full customer name" };
  const second = { ...columns[1], tooltip: "" };
  const visible = [first, second, columns[2]];
  const allColumns = [...visible, {columnId:"hidden", title:"Hidden", type:"text", tooltip:"Invisible"}];
  const descriptors = compileGridColumns(visible, allColumns, "en-GB");
  const { rows } = render({columns:visible, allColumns, descriptors});
  assert.equal(rows[0].cells.length, 3);
  assert.equal(rows[0].cells[0].tooltip, "Full customer name");
  assert.equal(rows[0].cells[0].text, "Name");
  assert.equal(rows[0].cells[0].style.height, 30);
  assert.equal(Object.hasOwn(rows[0].cells[1], "tooltip"), false);
  assert.equal(Object.hasOwn(rows[0].cells[2], "tooltip"), false);
});