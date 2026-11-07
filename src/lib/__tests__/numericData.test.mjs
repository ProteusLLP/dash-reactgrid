import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGridData, isNumericRows, NUMPY_MARKER } from "../numericData.js";
import { applyChanges, removeRows, rowIdsOf } from "../model.js";
import { editsPayload } from "../sparseEdits.js";
import { replayPendingEdits } from "../durableEdits.js";
import { compileGridColumns, buildGridRows } from "../gridRows.js";

const wire = (array, rows, cols, dtype = "float64") => ({
  [NUMPY_MARKER]: 1, dtype, shape: [rows, cols],
  bdata: Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64"),
});
const cols = [
  {columnId:"a",title:"A",type:"number"},
  {columnId:"b",title:"B",type:"number"},
];
const make = () => decodeGridData(wire(new Float64Array([1,2,3,4,5,6]),3,2));

test("dtype decoding, missing cells and exact row-major layout", () => {
  const cases = [
    [Float64Array, "float64", [1.5,-2.5]],
    [Float32Array, "float32", [1.5,-2.5]],
    [Int16Array, "int16", [2,-3]],
    [Uint32Array, "uint32", [3,5]],
    [Uint8Array, "bool", [true,false], [1,0]],
  ];
  for (const [Ctor,dtype,expected,raw = expected] of cases) {
    const rows = decodeGridData(wire(new Ctor(raw),1,2,dtype));
    assert.deepEqual(rows[0], expected);
    assert.equal(rows.length, 1);
  }
  const blanks = decodeGridData(wire(new Float64Array([NaN,Infinity]),1,2));
  assert.deepEqual(blanks[0], [null,null]);
  assert.deepEqual(decodeGridData([[2]]), [[2]]);
});

test("malformed binary data is rejected before allocation or access", () => {
  for(const malformed of [
    {[NUMPY_MARKER]:1,shape:[2,2],dtype:"float64",bdata:""},
    {[NUMPY_MARKER]:1,shape:[Number.MAX_SAFE_INTEGER,2],dtype:"float64",bdata:""},
    {[NUMPY_MARKER]:1,shape:[1,2],dtype:"float128",bdata:""},
    {[NUMPY_MARKER]:1,shape:[1,-2],dtype:"float64",bdata:""},
  ]) assert.throws(()=>decodeGridData(malformed));
});

test("on-demand page reads and immutable copy-on-write edits", () => {
  const data=make();
  const ids=rowIdsOf(data);
  assert.deepEqual(ids,[0,1,2]);
  assert.equal(data.cached.size,0,"id generation does not decode any rows");
  const first=data.slice(1,3);
  assert.deepEqual(first,[[3,4],[5,6]]);
  assert.equal(data.cached.size,2);
  assert.strictEqual(data[1],data[1],"decoded rows are cached");
  const next=applyChanges({data,rowIds:ids},[{rowId:1,columnId:"b",value:14}],
    {columns:cols});
  assert.equal(isNumericRows(next.data),true);
  assert.deepEqual(next.data[1],[3,14]);
  assert.deepEqual(data[1],[3,4],"source must not mutate");
  assert.strictEqual(next.data.values,data.values,"numeric buffer is shared");
  assert.equal(next.data.overrides.size,1);
  const payload=editsPayload(next,1,true,false);
  assert.equal(JSON.stringify(payload).includes("bdata"),false);
  assert.equal(JSON.stringify(payload).length<150,true);
  const full=editsPayload(next,2,false,true);
  assert.deepEqual(full.data,[[1,2],[3,14],[5,6]]);
});

test("row insertion, deletion and undo preserve stored numeric values", () => {
  const source=make();
  let table={data:source,rowIds:["r1","r2","r3"]};
  const next=applyChanges(table,[{rowId:"__ghost__",columnId:"a",value:99}],
    {columns:cols, makeId:()=> "r4"});
  assert.equal(next.data.length,4);
  assert.deepEqual(next.data[3],[99,null]);
  assert.equal(next.edits[0].kind,"add");
  const removed=removeRows(next,["r2"]);
  assert.equal(isNumericRows(removed.data),true);
  assert.deepEqual(removed.rowIds,["r1","r3","r4"]);
  assert.deepEqual(removed.data.slice(0,3),[[1,2],[5,6],[99,null]]);
  const edited=applyChanges(removed,[{rowId:"r3",columnId:"b",value:12}],{columns:cols});
  assert.deepEqual(edited.data[1],[5,12]);
  const undo=applyChanges(edited,[{rowId:"r3",columnId:"b",value:6}],{columns:cols});
  assert.deepEqual(undo.data[1],[5,6]);
  assert.deepEqual(source.toArray(),[[1,2],[3,4],[5,6]]);
});

test("replaying durable edits retains typed storage until structural changes", () => {
  const data=make();
  const rows=replayPendingEdits({data,rowIds:["a","b","c"]},
    [{edits:[{kind:"cell",rowId:"b",columnId:"a",value:77}]}],cols);
  assert.ok(isNumericRows(rows.data));
  assert.equal(rows.data[1][0],77);
  assert.equal(data[1][0],3);
});

test("durable pending deletions retain typed storage, overrides and row order", () => {
  const size = 100_000;
  const raw = new Float64Array(size * 2);
  for (let i = 0; i < size; i++) {
    raw[i * 2] = i;
    raw[i * 2 + 1] = i + 0.5;
  }
  const source = decodeGridData(wire(raw, size, 2));
  const ids = Array.from({length:size}, (_, i) => "r" + i);
  const removedOnly = replayPendingEdits({data:source,rowIds:ids},
    [{edits:[{kind:"remove",rowIds:["r0","r50000","r99999"]}]}],cols);
  assert.ok(isNumericRows(removedOnly.data));
  assert.strictEqual(removedOnly.data.values, source.values);
  assert.equal(removedOnly.data.cached.size, 0,
    "replaying a delete must not materialize surviving rows");

  const pending = [
    {edits:[
      {kind:"cell",rowId:"r1",columnId:"b",value:999},
      {kind:"remove",rowIds:["r0","r50000","r99999"]},
      {kind:"cell",rowId:"r1",columnId:"a",value:111},
    ]},
    {edits:[
      {kind:"remove",rowIds:["r0","r50000"]}, // retry is idempotent
      {kind:"cell",rowId:"r99998",columnId:"b",value:123},
    ]},
  ];
  const result = replayPendingEdits({data:source,rowIds:ids}, pending, cols);
  assert.ok(isNumericRows(result.data));
  assert.strictEqual(result.data.values, source.values);
  assert.equal(result.data.length, size - 3);
  assert.ok(result.data.cached.size <= 2,
    "only edited rows may be materialized on replay");
  assert.deepEqual(result.rowIds.slice(0,3), ["r1","r2","r3"]);
  assert.deepEqual(result.data[0], [111,999]);
  assert.deepEqual(result.data.at(-1), [99998,123]);
  assert.deepEqual(result.data[49999], [50001,50001.5]);
  assert.equal(source[1][0],1);
  assert.equal(source[1][1],1.5);
  assert.equal(source[50000][0],50000);
  assert.equal(source.overrides.size,0);
});

test("large numeric datasets do not build millions of row arrays", () => {
  const n=200_000,c=6;
  const original=new Float64Array(n*c);
  for(let i=0;i<n;i++)original[i*c]=i;
  const data=decodeGridData(wire(original,n,c));
  assert.equal(data.cached.size,0);
  assert.equal(data[199_999][0],199_999);
  assert.equal(data.cached.size,1);
  assert.equal(data.slice(199_800,200_000).length,200);
  assert.ok(data.cached.size<=201);
  const ids=rowIdsOf(data);
  const changed=applyChanges({data,rowIds:ids},[{rowId:199_999,columnId:"b",value:42}],
    {columns:Array.from({length:c},(_,i)=>({columnId:i===1?"b":String(i)}))});
  assert.strictEqual(changed.data.values,data.values);
  assert.equal(changed.data.overrides.size,1);
  assert.equal(data.cached.size<=201,true);
  assert.ok(JSON.stringify(editsPayload(changed,1,true,false)).length<160);
});

test("existing grid row builder renders virtual-sized windows from typed data", () => {
  const data=make();
  const desc=compileGridColumns(cols,cols,"en-GB");
  const result=buildGridRows({
    columns:cols,descriptors:desc,allColumns:cols,
    data:data.slice(0,2),rowIds:["r1","r2"],readOnly:false,
    locked:new Set(),showGhost:false,
  });
  assert.equal(result.rows.length,3);
  assert.equal(result.rows[2].cells[0].value,3);
});
