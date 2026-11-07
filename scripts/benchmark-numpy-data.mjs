/* Reproducible throughput/size benchmark, not a timing-sensitive test. */
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { decodeGridData, NUMPY_MARKER } from "../src/lib/numericData.js";
import { applyChanges } from "../src/lib/model.js";
import { editsPayload } from "../src/lib/sparseEdits.js";

const rows = 100_000;
const width = 10;
const values = new Float64Array(rows * width);
for (let i = 0; i < values.length; i++) {
  values[i] = Math.sin(i * 0.11) * Math.cos(i * 0.071) + i * 1e-7;
}
const start = performance.now();
const nested = Array.from({length: rows}, (_, i) =>
  Array.from({length: width}, (_, j) => values[i * width + j]));
const json = JSON.stringify(nested);
const jsonMs = performance.now() - start;
const binaryStart = performance.now();
const packed = {
  [NUMPY_MARKER]: 1,
  dtype: "float64",
  shape: [rows, width],
  bdata: Buffer.from(values.buffer).toString("base64"),
};
const packedJson = JSON.stringify(packed);
const packMs = performance.now() - binaryStart;
const parseStart = performance.now();
const plain = JSON.parse(json);
const jsonParseMs = performance.now() - parseStart;
const decodeStart = performance.now();
const lazy = decodeGridData(packed);
const decodeMs = performance.now() - decodeStart;
const columns = Array.from({length:width},(_,i)=>({columnId:String(i),type:"number"}));
const ids = Array.from({length: rows},(_,i)=>i);
const editStart = performance.now();
const edit = applyChanges({data:lazy,rowIds:ids}, [
  {rowId:rows-1,columnId:"5",value:8.25}
], {columns});
const editMs = performance.now() - editStart;
assert.equal(edit.data[rows-1][5],8.25);
assert.equal(plain[rows-1][5],values[(rows-1)*width+5]);
assert.equal(lazy.values.byteLength,8*rows*width);
assert.ok(edit.data.overrides.size===1);
assert.ok(JSON.stringify(editsPayload(edit,1,true,false)).length<180);
const mb = n => (n/1e6).toFixed(2);
console.log(JSON.stringify({
  shape: [rows,width],
  payloadMB:{json:mb(Buffer.byteLength(json)),binaryBase64:mb(Buffer.byteLength(packedJson))},
  numericBufferMB:mb(lazy.values.byteLength),
  decodeRowsAtLoad:lazy.cached.size,
  sparseEditedRows:edit.data.overrides.size,
  millis:{jsonEncode:Math.round(jsonMs),binaryEncode:Math.round(packMs),
          jsonParse:Math.round(jsonParseMs),binaryDecode:Math.round(decodeMs),
          sparseEdit:Math.round(editMs)},
},null,2));
