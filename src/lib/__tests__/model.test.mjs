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
