import { nativeEditorShortcut } from "../nativeEditorShortcut.js";
/* Regression tests for keyboard selection and clipboard handling. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearSelectedCells,
  focusedRange,
  isCellEditorTarget,
  isWholeGridSelected,
  pasteStartRow,
  selectAllRanges,
  selectionText,
  wholeGridRange,
} from "../keyboard.js";
import { GHOST_ROW_ID, textOf } from "../model.js";
import { parseClipboardTsv } from "../virtualOperations.js";

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


test("Delete on the final data cell clears the correct row, not the ghost", () => {
  const selected = [focusedRange(rows, columns, { rowId: "two", columnId: "weight" })];
  assert.deepEqual(clearSelectedCells(rows, columns, selected), [
    { rowId: "two", columnId: "weight", value: null },
  ]);
});

test("Delete on a Ctrl+A selection clears every real editable cell only", () => {
  const changes = clearSelectedCells(rows, columns, [wholeGridRange(rows, columns)]);
  assert.deepEqual(changes, [
    { rowId: "one", columnId: "name", value: "" },
    { rowId: "one", columnId: "weight", value: null },
    { rowId: "two", columnId: "name", value: "" },
    { rowId: "two", columnId: "weight", value: null },
  ]);
});

test("Delete respects nonEditable cells and ignores ghost-only selections", () => {
  const locked = rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell })) }));
  locked[2].cells[1].nonEditable = true;
  assert.deepEqual(clearSelectedCells(locked, columns, [focusedRange(locked, columns, { rowId: "two", columnId: "weight" })]), []);
  assert.deepEqual(clearSelectedCells(rows, columns, [focusedRange(rows, columns, { rowId: GHOST_ROW_ID, columnId: "weight" })]), []);
});

test("overlapping selected ranges clear a cell only once", () => {
  const selected = [wholeGridRange(rows, columns), focusedRange(rows, columns, { rowId: "two", columnId: "weight" })];
  assert.equal(clearSelectedCells(rows, columns, selected).length, 4);
});

test("checkbox clearing uses false rather than null", () => {
  const checkRows = [{ rowId: "one", cells: [{ type: "checkbox", checked: true }] }];
  assert.deepEqual(clearSelectedCells(checkRows, [{ columnId: "flag" }], [wholeGridRange(checkRows, [{ columnId: "flag" }])]), [
    { rowId: "one", columnId: "flag", value: false },
  ]);
});

test("server-virtualized copy excludes spacer rows and unfetched placeholders", () => {
  const virtualRows = [
    rows[0],
    { rowId:"__drg_virtual_spacer_top__",cells:rows[1].cells },
    { rowId:"loaded",cells:rows[2].cells },
    { rowId:"__drg_virtual_loading_123",cells:rows[1].cells },
    { rowId:"__drg_virtual_spacer_bottom__",cells:rows[1].cells },
  ];
  const full = wholeGridRange(virtualRows, columns);
  assert.equal(selectionText(virtualRows,[full],textOf),"Name\tWeight\nB\t2.5");
});

test("clipboard round-trips embedded tabs, line breaks and literal quotes", () => {
  const specialRows = [
    { rowId:"special", cells:[
      {type:"text",text:"Tab\\there"},
      {type:"text",text:'Quote "and"\\nnewline'},
    ] },
    { rowId:"next", cells:[
      {type:"text",text:'"whole quoted value"'},
      {type:"text",text:"ordinary"},
    ] },
  ].map(row=>({...row,cells:row.cells.map(cell=>({
    ...cell,text:cell.text.replaceAll("\\t","\t").replaceAll("\\n","\n"),
  }))}));
  const serialized=selectionText(specialRows,
    [wholeGridRange(specialRows,columns)],textOf);
  assert.deepEqual(parseClipboardTsv(serialized),[
    ["Tab\there",'Quote "and"\nnewline'],
    ['"whole quoted value"',"ordinary"],
  ]);
});

test("numeric and percent editors preserve native Ctrl/Cmd shortcuts", () => {
  for (const key of ["a", "c", "v", "x", "z", "y"]) {
    assert.equal(nativeEditorShortcut({ key, ctrlKey:true, metaKey:false, altKey:false }), true);
    assert.equal(nativeEditorShortcut({ key:key.toUpperCase(), ctrlKey:false, metaKey:true, altKey:false }), true);
  }
  assert.equal(nativeEditorShortcut({ key:"a", ctrlKey:false, metaKey:false, altKey:false }), false);
  assert.equal(nativeEditorShortcut({ key:"a", ctrlKey:true, metaKey:false, altKey:true }), false);
  assert.equal(nativeEditorShortcut({ key:"ArrowLeft", ctrlKey:true, metaKey:false, altKey:false }), false);
});

test("Excel direct-entry arrow navigation excludes modified shortcuts", async () => {
  const { isPlainArrow, isTypingKey } = await import("../keyboardEntry.js");
  assert.equal(isPlainArrow({ key:"ArrowRight",ctrlKey:false,metaKey:false,altKey:false,shiftKey:false }),true);
  assert.equal(isPlainArrow({ key:"ArrowUp",ctrlKey:false,metaKey:false,altKey:false,shiftKey:true }),false);
  assert.equal(isPlainArrow({ key:"Enter",ctrlKey:false,metaKey:false,altKey:false,shiftKey:false }),false);
  assert.equal(isTypingKey("A",false,false),true);
  assert.equal(isTypingKey("!",false,false),true);
  assert.equal(isTypingKey("A",true,false),false);
});

test("direct date typing parses ISO and the locale's day/month order and rejects rollovers", async () => {
  const { parseDateEntry } = await import("../keyboardEntry.js");
  assert.equal(parseDateEntry("2026-11-14","en-GB").getDate(),14);
  assert.equal(parseDateEntry("14/11/2026","en-GB").getMonth(),10);
  assert.equal(parseDateEntry("11/14/2026","en-US").getMonth(),10);
  assert.equal(parseDateEntry("31/02/2026","en-GB"),null);
  assert.equal(parseDateEntry("2025-02-29","en-GB"),null);
  assert.equal(parseDateEntry("2024-02-29","en-GB").getDate(),29);
  assert.equal(parseDateEntry("bad","en-GB"),null);
});

test("direct time typing validates 24h time and retains the base date", async () => {
  const { parseTimeEntry } = await import("../keyboardEntry.js");
  const base = new Date(2026,10,7,9,10,0);
  const result = parseTimeEntry("15:45",base);
  assert.equal(result.getHours(),15);
  assert.equal(result.getMinutes(),45);
  assert.equal(result.getDate(),7);
  assert.equal(parseTimeEntry("24:00",base),null);
  assert.equal(parseTimeEntry("15:60",base),null);
  assert.equal(parseTimeEntry("not time",base),null);
});
