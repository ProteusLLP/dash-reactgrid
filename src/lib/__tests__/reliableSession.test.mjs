import {test} from "node:test";
import assert from "node:assert/strict";
import {makeSession,reconcileSession} from "../useReliableGrid.js";
import {outboxStorageKey} from "../durableEdits.js";

const fakeBrowser = (invalid = false) => {
  const records=new Map();
  return {
    crypto:{randomUUID:()=>"stable-test-stream",getRandomValues:(bytes)=>bytes.fill(1)},
    sessionStorage:{
      getItem:(key)=>invalid?"not valid JSON":records.get(key) ?? null,
      setItem:(key,value)=>records.set(key,value),
    },
  };
};

const config = (changes={}) => ({
  enabled:true,id:"grid",datasetId:"dataset-a",
  data:[["Alice",3]],rowIds:["r1"],
  columns:[{columnId:"name",title:"Name"},{columnId:"amount",title:"Amount"}],
  newRow:null,windowed:false,...changes,
});

test("invalid sparse props do not recreate failed sessions on every render",()=>{
  const invalid=config({id:null,datasetId:null});
  const first=makeSession(invalid);
  assert.ok(first.error);
  assert.equal(first.key,null);
  assert.strictEqual(reconcileSession(first,invalid),first);
  assert.strictEqual(reconcileSession(first,{...invalid}),first);
  const old=globalThis.window;
  try {
    globalThis.window=fakeBrowser();
    const fixed=config();
    const ready=reconcileSession(first,fixed);
    assert.equal(ready.error,null);
    assert.ok(ready.outbox);
    assert.equal(ready.outbox.streamId,"stable-test-stream");
  } finally {globalThis.window=old;}
});

test("corrupt sessionStorage remains stable until the configuration changes",()=>{
  const old=globalThis.window;
  try {
    globalThis.window=fakeBrowser(true);
    const initial=config();
    const corrupt=makeSession(initial);
    assert.match(corrupt.error,/recover/i);
    assert.strictEqual(reconcileSession(corrupt,initial),corrupt);
    assert.strictEqual(reconcileSession(corrupt,{...initial}),corrupt);
    globalThis.window=fakeBrowser();
    const changed={...initial,datasetId:"dataset-b"};
    const restored=reconcileSession(corrupt,changed);
    assert.equal(restored.error,null);
    assert.equal(restored.outbox.datasetId,"dataset-b");
  }finally {globalThis.window=old;}
});

test("metadata-only props preserve local acknowledged sparse edits",()=>{
  const old=globalThis.window;
  try {
    globalThis.window=fakeBrowser();
    const first=config();
    const session=makeSession(first);
    assert.equal(session.error,null);
    const edited={...session,table:{rowIds:session.table.rowIds,
      data:[["Local edit",12]]}};
    const cosmetic=config({
      data:first.data,rowIds:first.rowIds,
      columns:[{columnId:"name",title:"Renamed"},
               {columnId:"amount",title:"Changed width",width:250}],
      newRow:{amount:0},
    });
    const retained=reconcileSession(edited,cosmetic);
    assert.deepEqual(retained.table.data,[["Local edit",12]]);
    assert.strictEqual(retained.table.data,edited.table.data);
    const reordered=reconcileSession(retained,{
      ...cosmetic,
      columns:[cosmetic.columns[1],cosmetic.columns[0]],
    });
    assert.deepEqual(reordered.table.data,[[12,"Local edit"]]);
    const authoritative=reconcileSession(reordered,{
      ...cosmetic,data:[["Server refresh",99]],rowIds:["r1"],
    });
    assert.deepEqual(authoritative.table.data,[["Server refresh",99]]);
  }finally {globalThis.window=old;}
});
