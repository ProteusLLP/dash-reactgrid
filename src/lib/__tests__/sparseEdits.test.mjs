/* Tests of the browser-owned grid and edits-only wire protocol. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChanges, removeRows, GHOST_ROW_ID } from "../model.js";
import {
  initialGridSnapshot, reconcileGridSnapshot, commitGridSnapshot, editsPayload,
} from "../sparseEdits.js";

const columns = [
  { columnId: "name", type: "text" },
  { columnId: "amount", type: "number" },
];
const source = [["A", 1], ["B", 2]];
const ids = ["r1", "r2"];
const initial = () => initialGridSnapshot(source, ids, true);
let idNum = 0;
const makeId = () => "new-" + ++idNum;

test("full-data mode keeps backwards-compatible data and rowIds publications", () => {
  const next = applyChanges({ data: source, rowIds: ids }, [
    { rowId: "r2", columnId: "amount", value: 12 },
  ], { columns });
  assert.deepEqual(editsPayload(next, 4, false, true), {
    data: next.data,
    rowIds: next.rowIds,
    edits: { seq: 4, edits: [{ kind: "cell", rowId: "r2", columnId: "amount", value: 12 }] },
  });
  assert.deepEqual(Object.keys(editsPayload(next, 4, false, false)).sort(), ["data", "edits"]);
  assert.equal(editsPayload({ ...next, edits: [] }, 5, false, true), null);
});

test("sparse mode publishes only one small edits object for a cell change", () => {
  const next = applyChanges(initial().table, [
    { rowId: "r2", columnId: "amount", value: 12 },
  ], { columns });
  const outbound = editsPayload(next, 7, true, true);
  assert.deepEqual(outbound, {
    edits: { seq: 7, edits: [{ kind: "cell", rowId: "r2", columnId: "amount", value: 12 }] },
  });
  assert.equal("data" in outbound, false);
  assert.equal("rowIds" in outbound, false);
  assert.equal("data" in outbound.edits, false);
});

test("multiple successive edits accumulate in the browser, not the server prop", () => {
  let local = initial();
  const first = applyChanges(local.table, [{ rowId: "r1", columnId: "amount", value: 5 }], { columns });
  local = commitGridSnapshot(local, first);
  const second = applyChanges(local.table, [{ rowId: "r2", columnId: "name", value: "C" }], { columns });
  local = commitGridSnapshot(local, second);
  assert.deepEqual(local.table.data, [["A", 5], ["C", 2]]);
  assert.deepEqual(source, [["A", 1], ["B", 2]]);
  assert.strictEqual(local.sourceData, source);
  assert.strictEqual(reconcileGridSnapshot(local, source, ids, true), local,
    "Dash rerendering for the edits property must not reset the local table");
  assert.deepEqual(editsPayload(second, 2, true, true).edits.edits, [
    { kind: "cell", rowId: "r2", columnId: "name", value: "C" },
  ]);
});

test("extendable-row addition and subsequent edit retain the new stable ID", () => {
  let local = initial();
  const inserted = applyChanges(local.table, [
    { rowId: GHOST_ROW_ID, columnId: "name", value: "C" },
  ], { columns, newRow: { amount: 100 }, makeId: makeId });
  assert.deepEqual(inserted.edits.map((e) => e.kind), ["add", "cell"]);
  local = commitGridSnapshot(local, inserted);
  const newId = inserted.rowIds.at(-1);
  const amended = applyChanges(local.table, [
    { rowId: newId, columnId: "amount", value: 120 },
  ], { columns });
  local = commitGridSnapshot(local, amended);
  assert.deepEqual(local.table.data.at(-1), ["C", 120]);
  assert.equal(editsPayload(inserted, 1, true, true).edits.edits[0].rowId, newId);
  assert.deepEqual(editsPayload(amended, 2, true, true).edits.edits, [
    { kind: "cell", rowId: newId, columnId: "amount", value: 120 },
  ]);
});

test("deleting rows locally publishes only removed IDs and updates subsequent edits", () => {
  let local = initial();
  const removed = removeRows(local.table, ["r1"]);
  local = commitGridSnapshot(local, removed);
  assert.deepEqual(local.table.data, [["B", 2]]);
  assert.deepEqual(local.table.rowIds, ["r2"]);
  assert.deepEqual(editsPayload(removed, 11, true, true), {
    edits: { seq: 11, edits: [{ kind: "remove", rowIds: ["r1"] }] },
  });
  const changed = applyChanges(local.table, [{ rowId: "r2", columnId: "amount", value: 9 }], { columns });
  assert.deepEqual(changed.data, [["B", 9]]);
});

test("undo-style inverse edit updates the local value and publishes an inverse delta", () => {
  let local = initial();
  const next = applyChanges(local.table, [{ rowId: "r1", columnId: "amount", value: 9 }], { columns });
  local = commitGridSnapshot(local, next);
  const undo = applyChanges(local.table, [{ rowId: "r1", columnId: "amount", value: 1 }], { columns });
  local = commitGridSnapshot(local, undo);
  assert.deepEqual(local.table.data, source);
  assert.deepEqual(editsPayload(undo, 13, true, true).edits.edits, [
    { kind: "cell", rowId: "r1", columnId: "amount", value: 1 },
  ]);
});

test("new server-supplied data and row ids replace locally edited values", () => {
  const changed = applyChanges(initial().table, [{ rowId: "r1", columnId: "name", value: "Local" }], { columns });
  const local = commitGridSnapshot(initial(), changed);
  const serverData = [["Server", 55]];
  const serverIds = ["new-server-id"];
  const reconciled = reconcileGridSnapshot(local, serverData, serverIds, true);
  assert.deepEqual(reconciled.table, { data: serverData, rowIds: serverIds });
  assert.strictEqual(reconciled.table.data, serverData);
  assert.notStrictEqual(reconciled, local);
  assert.strictEqual(reconcileGridSnapshot(reconciled, serverData, serverIds, true), reconciled);
});

test("switching mode or supplying new row IDs resets the local snapshot", () => {
  const changed = applyChanges(initial().table, [{ rowId: "r1", columnId: "name", value: "Local" }], { columns });
  const local = commitGridSnapshot(initial(), changed);
  assert.strictEqual(reconcileGridSnapshot(local, source, ids, false).table.data, source);
  assert.deepEqual(reconcileGridSnapshot(local, source, ["x", "y"], true).table.rowIds, ["x", "y"]);
  assert.deepEqual(initialGridSnapshot(source, undefined, true).table.rowIds, [0, 1]);
});

test("sparse payload stays small even with a 100k-row source dataset", () => {
  const size = 100_000;
  const largeRows = Array.from({ length: size }, (_, i) => ["row-" + i, i]);
  const largeIds = Array.from({ length: size }, (_, i) => "r-" + i);
  const next = applyChanges({ data: largeRows, rowIds: largeIds }, [
    { rowId: "r-99999", columnId: "amount", value: 42 },
  ], { columns });
  const payload = editsPayload(next, 5, true, true);
  assert.ok(JSON.stringify(payload).length < 160);
  assert.strictEqual(next.data[0], largeRows[0]);
});
