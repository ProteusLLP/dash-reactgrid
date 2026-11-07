/* Tests of the grid's data model: `npm run test:js`. */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GHOST_ROW_ID,
  applyChanges,
  parseText,
  pastedValue,
  removeRows,
  rowIdsOf,
  rowIndexesOf,
  rowsInRanges,
} from "../model.js";

const columns = [
  { columnId: "name", type: "text" },
  { columnId: "weight", type: "number" },
  { columnId: "kind", type: "dropdown", values: ["bond", "equity"] },
  { columnId: "credit", type: "checkbox" },
];
const table = { data: [["a", 1, "bond", false], ["b", 2, "equity", true]], rowIds: ["r1", "r2"] };
const parsers = { number: { parse: Number }, percent: { parse: (t) => Number(t.replace("%", "")) / 100 } };
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

test("a cell change names its row by id", () => {
  const next = applyChanges(table, [{ rowId: "r2", columnId: "weight", value: 5 }], { columns, makeId: ids() });
  assert.deepEqual(next.data[1], ["b", 5, "equity", true]);
  assert.deepEqual(next.edits, [{ kind: "cell", rowId: "r2", columnId: "weight", value: 5 }]);
  assert.deepEqual(table.data[1], ["b", 2, "equity", true], "the table it was given is unchanged");
});

test("an unchanged value is no edit", () => {
  const next = applyChanges(table, [{ rowId: "r1", columnId: "name", value: "a" }], { columns });
  assert.deepEqual(next.edits, []);
});

test("typing in the ghost row adds a row from the template", () => {
  const next = applyChanges(
    table,
    [{ rowId: GHOST_ROW_ID, columnId: "name", value: "c" }],
    { columns, newRow: { kind: "bond", credit: false }, makeId: ids() },
  );
  assert.deepEqual(next.rowIds, ["r1", "r2", "new-1"]);
  assert.deepEqual(next.data[2], ["c", null, "bond", false]);
  assert.deepEqual(next.edits, [
    { kind: "add", rowId: "new-1" },
    { kind: "cell", rowId: "new-1", columnId: "name", value: "c" },
  ]);
});

test("a paste past the end adds rows in order", () => {
  const next = applyChanges(
    table,
    [
      { rowId: { ghost: 1 }, columnId: "name", value: "d" },
      { rowId: { ghost: 0 }, columnId: "name", value: "c" },
    ],
    { columns, makeId: ids() },
  );
  assert.deepEqual(next.rowIds, ["r1", "r2", "new-1", "new-2"]);
  assert.deepEqual(next.data.map((row) => row[0]), ["a", "b", "c", "d"]);
  assert.deepEqual(next.edits.filter((e) => e.kind === "add").map((e) => e.rowId), ["new-1", "new-2"]);
});

test("removing rows keeps the others' ids", () => {
  const next = removeRows(table, ["r1", "missing"]);
  assert.deepEqual(next.rowIds, ["r2"]);
  assert.deepEqual(next.edits, [{ kind: "remove", rowIds: ["r1"] }]);
  assert.deepEqual(removeRows(table, ["missing"]).edits, []);
});

test("rows without ids are named by position", () => {
  assert.deepEqual(rowIdsOf([[1], [2]], undefined), [0, 1]);
});

test("pasted text takes the column's type", () => {
  assert.equal(parseText(columns[1], " 2.5 ", parsers), 2.5);
  assert.equal(parseText(columns[1], "", parsers), null);
  assert.equal(parseText(columns[1], "abc", parsers), null);
  assert.equal(parseText(columns[2], "equity", parsers), "equity");
  assert.equal(parseText(columns[2], "cash", parsers), null);
  assert.equal(parseText(columns[3], "TRUE", parsers), true);
  assert.equal(parseText({ type: "percent" }, "50%", parsers), 0.5);
  assert.equal(parseText({ type: "percent" }, "0.35", parsers), 0.35, "a copied fraction");
  assert.equal(pastedValue(columns[1], { type: "customnumber", value: 3 }, parsers), 3);
});

test("selected ranges give their rows once, without header or ghost", () => {
  const ranges = [{ rows: [{ rowId: "header" }, { rowId: "r1" }, { rowId: "r2" }] }, { rows: [{ rowId: "r2" }, { rowId: GHOST_ROW_ID }] }];
  assert.deepEqual(rowsInRanges(ranges), ["r1", "r2"]);
});

test("editable-when rules read the row's other values", async () => {
  const { rulesHold } = await import("../model.js");
  const ids = ["type", "credit", "rate"];
  const rate = { columnId: "rate", editableWhen: [{ columnId: "type", in: ["bond"] }, { columnId: "credit", truthy: true }] };
  assert.equal(rulesHold(rate, ["bond", true, 1], ids), true);
  assert.equal(rulesHold(rate, ["equity", true, 1], ids), false);
  assert.equal(rulesHold(rate, ["bond", false, 1], ids), false);
  assert.equal(rulesHold({ columnId: "type" }, ["x"], ids), true);
});

test("sticky counts leave a row and a column to scroll", async () => {
  const { stickyCounts } = await import("../model.js");
  const props = { stickyLeftColumns: 2, stickyRightColumns: 1, stickyTopRows: 1, stickyBottomRows: 0 };
  assert.deepEqual(stickyCounts(props, 1, 1), { left: 0, right: 0, top: 0, bottom: 0 });
  assert.deepEqual(stickyCounts(props, 3, 2), { left: 2, right: 0, top: 1, bottom: 0 });
  assert.deepEqual(stickyCounts(props, 5, 10), { left: 2, right: 1, top: 1, bottom: 0 });
});

test("a column's class is safe in a selector", async () => {
  const { columnClass } = await import("../model.js");
  assert.equal(columnClass("cf_face_value"), "rg-col-cf_face_value");
  assert.equal(columnClass('["USD","Model","x"]'), "rg-col-__USD___Model___x__");
});


test("Delete or Backspace on the final real cell clears it without adding a row", () => {
  const next = applyChanges(table, [{ rowId: "r2", columnId: "kind", value: null }], { columns, makeId: ids() });
  assert.deepEqual(next.rowIds, ["r1", "r2"]);
  assert.equal(next.data[1][2], null);
  assert.deepEqual(next.edits, [{ kind: "cell", rowId: "r2", columnId: "kind", value: null }]);
});

test("Delete on the final blank extension cell must not add an empty row", () => {
  const next = applyChanges(table, [
    { rowId: GHOST_ROW_ID, columnId: "name", value: "" },
    { rowId: GHOST_ROW_ID, columnId: "weight", value: null },
    { rowId: GHOST_ROW_ID, columnId: "kind", value: null },
    { rowId: GHOST_ROW_ID, columnId: "credit", value: false },
  ], { columns, newRow: { kind: "bond" }, makeId: ids() });
  assert.deepEqual(next.rowIds, table.rowIds);
  assert.deepEqual(next.data, table.data);
  assert.deepEqual(next.edits, []);
});

test("blank trailing paste rows do not grow an extendable table", () => {
  const next = applyChanges(table, [
    { rowId: { ghost: 0 }, columnId: "name", value: "C" },
    { rowId: { ghost: 1 }, columnId: "name", value: "" },
    { rowId: { ghost: 1 }, columnId: "weight", value: null },
  ], { columns, makeId: ids() });
  assert.deepEqual(next.rowIds, ["r1", "r2", "new-1"]);
  assert.equal(next.data[2][0], "C");
});


test("updating a large table clones only touched rows", () => {
  const size = 100_000;
  const values = Array.from({ length: size }, (_, i) => ["r" + i, i, "bond", false]);
  const ids = Array.from({ length: size }, (_, i) => "row-" + i);
  const large = { data: values, rowIds: ids };
  const next = applyChanges(large, [{ rowId: "row-95000", columnId: "weight", value: 99 }], { columns });
  assert.notStrictEqual(next.data, large.data);
  assert.strictEqual(next.rowIds, large.rowIds, "row ids are unchanged for cell-only edits");
  assert.strictEqual(next.data[0], large.data[0], "rows before the change share references");
  assert.strictEqual(next.data[99_999], large.data[99_999], "rows after the change share references");
  assert.notStrictEqual(next.data[95_000], large.data[95_000]);
  assert.equal(next.data[95_000][1], 99);
  assert.equal(large.data[95_000][1], 95_000);
  const unchanged = applyChanges(large, [{ rowId: "row-95000", columnId: "weight", value: 95000 }], { columns });
  assert.strictEqual(unchanged.data, large.data, "no-op does not copy any rows");
  assert.strictEqual(unchanged.rowIds, large.rowIds);
});

test("a bulk paste changes each source row only once and keeps all other rows shared", () => {
  const bulk = { data: Array.from({ length: 1000 }, (_, i) => ["item-" + i, i, "bond", false]),
    rowIds: Array.from({ length: 1000 }, (_, i) => "row-" + i) };
  const edits = Array.from({ length: 200 }, (_, i) => [
    { rowId: "row-" + i, columnId: "name", value: "new-" + i },
    { rowId: "row-" + i, columnId: "weight", value: 100 + i },
  ]).flat();
  const next = applyChanges(bulk, edits, { columns });
  assert.equal(next.edits.length, 400);
  assert.equal(next.data[199][1], 299);
  assert.strictEqual(next.data[200], bulk.data[200]);
  assert.equal(bulk.data[0][0], "item-0");
});

test("a row addition preserves the previous rows and makes a new id array", () => {
  const next = applyChanges(table, [{ rowId: GHOST_ROW_ID, columnId: "name", value: "new" }],
    { columns, makeId: ids() });
  assert.strictEqual(next.data[0], table.data[0]);
  assert.notStrictEqual(next.rowIds, table.rowIds);
  assert.equal(next.rowIds.length, 3);
});

test("bulk row deletion uses stable ids", () => {
  const next = removeRows(table, ["r1", "r1", "no-such-row"]);
  assert.deepEqual(next.rowIds, ["r2"]);
  assert.deepEqual(next.edits, [{ kind: "remove", rowIds: ["r1"] }]);
});

test("complete row ids and their lookup index retain reference identity across edits", () => {
  assert.strictEqual(rowIdsOf(table.data, table.rowIds), table.rowIds);
  assert.strictEqual(rowIndexesOf(table.rowIds), rowIndexesOf(table.rowIds));
  assert.equal(rowIndexesOf(table.rowIds).get("r2"), 1);
  assert.deepEqual(rowIdsOf([[1], [2]], ["a", undefined]), ["a", 1]);
});
