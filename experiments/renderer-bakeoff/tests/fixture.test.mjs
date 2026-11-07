import test from "node:test";
import assert from "node:assert/strict";
import { Fixture, parseOptions } from "../src/fixture.js";

test("URL options are bounded and cannot trigger unbounded allocations", () => {
  assert.equal(parseOptions("?renderer=glide&rows=999999999&cols=999").rows, 1_000_000);
  assert.equal(parseOptions("?renderer=invalid&rows=-1").renderer, "glide");
  assert.equal(parseOptions("?renderer=revogrid&mode=mixed").mode, "mixed");
  assert.throws(() => new Fixture({ rows: 1_000_000, cols: 12, mode: "numeric" }), RangeError);
});

test("numeric data uses one Float64Array and sparse edits do not copy it", () => {
  const f = new Fixture({ rows: 100_000, cols: 12, mode: "numeric" });
  const original = f.numeric;
  assert.equal(f.get(0, 0), 0.01);
  assert.equal(f.get(99_999, 11), 1000.11);
  assert.equal(f.write(99_999, 11, "42.5"), true);
  assert.equal(f.numeric, original);
  assert.equal(f.get(99_999, 11), 42.5);
  assert.deepEqual(f.edits, [
    {kind:"cell", rowId:"r-99999", columnId:"n11", value:42.5},
  ]);
  assert.equal(f.write(99_999, 11, "invalid"), false);
  assert.equal(f.edits.length, 1);
});

test("mixed cell schema, coercion and read-only enforcement match shared contract", () => {
  const f = new Fixture({ rows: 12, cols: 8, mode: "mixed" });
  assert.deepEqual(f.columns.map(c => c.type),
    ["text", "number", "percent", "checkbox", "dropdown", "date", "time", "text"]);
  assert.equal(f.write(0, 0, "Edited"), true);
  assert.equal(f.write(0, 2, "35%"), true);
  assert.equal(f.get(0, 2), 0.35);
  assert.equal(f.write(0, 3, "false"), true);
  assert.equal(f.get(0, 3), false);
  assert.equal(f.write(0, 4, "BAD"), false);
  assert.equal(f.write(0, 4, "C"), true);
  assert.equal(f.write(0, 7, "no"), false);
  assert.equal(f.write(-1, 0, "no"), false);
  assert.equal(f.write(0, 9, "no"), false);
  assert.equal(f.get(0, 7), "LOCKED 0");
  assert.equal(f.edits.length, 4);
  assert.deepEqual(f.edits.map(e => e.columnId), ["label","ratio","flag","choice"]);
});

test("row records for RevoGrid and lazy access expose identical values", () => {
  const f = new Fixture({ rows: 3, cols: 8, mode: "mixed" });
  const rows = f.rows(1, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].__row, 1);
  for (let r = 1; r < 3; r++)
    for (let c = 0; c < f.columns.length; c++)
      assert.deepEqual(rows[r - 1][f.columns[c].columnId], f.get(r, c));
});
