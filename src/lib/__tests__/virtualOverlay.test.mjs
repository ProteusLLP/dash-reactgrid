import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayVirtualEdits } from "../virtualOverlay.js";

const columns=[{columnId:"name"},{columnId:"value"}];
const source={rowIds:["r500","r501"],data:[["A",1],["B",2]]};

test("replays matching pending edits but never needs rows outside the loaded window",()=>{
  const queue=[
    {edits:[{kind:"cell",rowId:"r1",columnId:"value",value:99},
            {kind:"cell",rowId:"r501",columnId:"value",value:20}]},
    {edits:[{kind:"cell",rowId:"r501",columnId:"value",value:21}]},
  ];
  const next=overlayVirtualEdits(source,queue,columns);
  assert.deepEqual(next.data,[["A",1],["B",21]]);
  assert.deepEqual(source.data,[["A",1],["B",2]]);
  assert.strictEqual(next.data[0],source.data[0]);
  assert.notStrictEqual(next.data[1],source.data[1]);
  assert.strictEqual(next.rowIds,source.rowIds);
});

test("no matching edits preserves the same server window object",()=>{
  const queue=[{edits:[{kind:"cell",rowId:"r100",columnId:"value",value:1}]}];
  assert.strictEqual(overlayVirtualEdits(source,queue,columns),source);
  assert.strictEqual(overlayVirtualEdits(source,[],columns),source);
  assert.strictEqual(overlayVirtualEdits(null,queue,columns),null);
});

test("duplicate retries and already-applied server edits are idempotent",()=>{
  const queue=[{edits:[{kind:"cell",rowId:"r500",columnId:"name",value:"Updated"}]}];
  const applied=overlayVirtualEdits(source,queue,columns);
  assert.strictEqual(overlayVirtualEdits(applied,queue,columns),applied);
  const afterReload={rowIds:["r500","r501"],data:[["Updated",1],["B",2]]};
  assert.strictEqual(overlayVirtualEdits(afterReload,queue,columns),afterReload);
});
