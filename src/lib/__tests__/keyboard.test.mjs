/* Regression tests for keyboard selection and clipboard handling. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusedRange,
  isCellEditorTarget,
  isWholeGridSelected,
  pasteStartRow,
  selectAllRanges,
  selectionText,
  wholeGridRange,
} from "../keyboard.js";
import { GHOST_ROW_ID, textOf } from "../model.js";

const columns = [{ columnId: "name" }, { columnId: "weight" }];
const rows = [
  { rowId: "header", cells: [{ type: "header", text: "Name" }, { type: "header", text: "Weight" }] },
  { rowId: "one", cells: [{ type: "text", text: "A" }, { type: "customnumber", value: 1.25 }] },
  { rowId: "two", cells: [{ type: "text", text: "B" }, { type: "customnumber", value: 2.5 }] },
  { rowId: GHOST_ROW_ID, cells: [{ type: "text", text: "" }, { type: "customnumber", value: NaN }] },
];

test("Ctrl+A selects every visible row and column, even if only one cell was selected", () => {
  const initial = [focusedRange(rows, columns, { rowId: "two", columnId: "weight" })];
  const selected = selectAllRanges(initial, rows, columns, { rowId: "two", columnId: "weight" });
  assert.equal(selected.length, 1);
  assert.equal(isWholeGridSelected(selected, rows, columns), true);
  assert.deepEqual(selected[0].rows.map((row) => row.rowId), ["header", "one", "two", GHOST_ROW_ID]);
  assert.deepEqual(selected[0].columns.map((col) => col.columnId), ["name", "weight"]);
});

test("Ctrl+A twice returns to the focused cell, like ReactGrid's own keyboard handler", () => {
  const selected = selectAllRanges([wholeGridRange(rows, columns)], rows, columns, { rowId: "two", columnId: "weight" });
  assert.equal(isWholeGridSelected(selected, rows, columns), false);
  assert.equal(selected[0].first.row.idx, 2);
  assert.equal(selected[0].last.column.idx, 1);
  assert.equal(selected[0].rows.length, 1);
  assert.equal(selected[0].columns.length, 1);
});

test("copy after Ctrl+A contains the full visible table, excluding the blank extension row", () => {
  const oneCell = [focusedRange(rows, columns, { rowId: "two", columnId: "weight" })];
  assert.equal(selectionText(rows, oneCell, textOf), "2.5");
  const selected = selectAllRanges(oneCell, rows, columns, { rowId: "two", columnId: "weight" });
  assert.equal(selectionText(rows, selected, textOf), "Name\tWeight\nA\t1.25\nB\t2.5");
});

test("copy respects a smaller manually selected range", () => {
  const range = {
    first: { row: { idx: 1 }, column: { idx: 0 } },
    last: { row: { idx: 2 }, column: { idx: 1 } },
  };
  assert.equal(selectionText(rows, [range], textOf), "A\t1.25\nB\t2.5");
  assert.equal(selectionText(rows, [], textOf), null);
});

test("pasting into a Ctrl+A selection starts at the first data row, not the header", () => {
  assert.equal(pasteStartRow(wholeGridRange(rows, columns)), 0);
  assert.equal(pasteStartRow(focusedRange(rows, columns, { rowId: "two", columnId: "weight" })), 1);
  assert.equal(pasteStartRow(focusedRange(rows, columns, { rowId: GHOST_ROW_ID, columnId: "weight" })), 2);
});

test("Ctrl+A inside a cell editor must select its text instead of the grid", () => {
  assert.equal(isCellEditorTarget({ closest: (selector) => selector.includes("input:not") ? {} : null }), true);
  assert.equal(isCellEditorTarget({ closest: () => null }), false);
  assert.equal(isCellEditorTarget(null), false);
});

test("an empty grid has no selection to copy", () => {
  assert.equal(wholeGridRange([], columns), null);
  assert.equal(selectAllRanges([], [], columns, null).length, 0);
});
