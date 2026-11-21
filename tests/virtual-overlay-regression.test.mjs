import test from "node:test";
import assert from "node:assert/strict";
import { overlayVirtualEdits } from "../src/lib/virtualOverlay.js";

const columns = [{ columnId: "a" }, { columnId: "b" }];
const page = () => ({
  start: 100,
  rowIds: ["row-100", "row-101"],
  data: [[1, 2], [3, 4]],
});
const batch = (...edits) => ({ edits });

test("offscreen and unknown-column edits preserve the exact viewport object", () => {
  const original = page();
  const result = overlayVirtualEdits(original, [
    batch({ kind: "cell", rowId: "row-999", columnId: "a", value: 9 },
      { kind: "cell", rowId: "row-100", columnId: "missing", value: 8 }),
  ], columns);
  assert.strictEqual(result, original);
});

test("pending edits overlay by stable row and column IDs without mutating server data", () => {
  const original = page();
  const firstRow = original.data[0];
  const secondRow = original.data[1];
  const result = overlayVirtualEdits(original, [
    batch({ kind: "cell", rowId: "row-101", columnId: "b", value: 8 }),
    batch({ kind: "cell", rowId: "row-101", columnId: "b", value: 9 }),
  ], columns);
  assert.deepEqual(result.data, [[1, 2], [3, 9]]);
  assert.deepEqual(original.data, [[1, 2], [3, 4]]);
  assert.strictEqual(result.data[0], firstRow);
  assert.notStrictEqual(result.data[1], secondRow);
});

test("column reordering uses column IDs rather than original positions", () => {
  const original = page();
  const result = overlayVirtualEdits(original, [
    batch({ kind: "cell", rowId: "row-100", columnId: "a", value: 12 }),
  ], [columns[1], columns[0]]);
  assert.deepEqual(result.data[0], [1, 12]);
});

test("paste clips to the visible viewport and preserves untouched rows", () => {
  const original = page();
  const result = overlayVirtualEdits(original, [
    batch({ kind: "paste", start: 99, columnIds: ["b"], rows: [[7], [8], [9], [10]] }),
  ], columns);
  assert.deepEqual(result.data, [[1, 8], [3, 9]]);
  assert.deepEqual(original.data, [[1, 2], [3, 4]]);
});

test("a paste with an unknown column is ignored atomically", () => {
  const original = page();
  const result = overlayVirtualEdits(original, [
    batch({ kind: "paste", start: 100, columnIds: ["a", "unknown"], rows: [[8, 9]] }),
  ], columns);
  assert.strictEqual(result, original);
});

test("empty queue and absent viewport are unchanged", () => {
  const original = page();
  assert.strictEqual(overlayVirtualEdits(original, [], columns), original);
  assert.strictEqual(overlayVirtualEdits(null, [batch()], columns), null);
});
