import {test} from "node:test";
import assert from "node:assert/strict";
import {
  boundedSelection,extendSelection,parseClipboardTsv,makeRangePaste,
  copyRequestFor,matchesCopyResponse,initialHistory,historyStorageKey,
  loadHistory,saveHistory,nextHistory,
} from "../virtualOperations.js";
const cols=[{columnId:"name",type:"text"},{columnId:"amount",type:"number"}];
const selected={start:500,end:800,columnStart:0,columnEnd:2};
test("global selection spans arbitrarily distant unloaded rows without listing them",()=>{
  assert.deepEqual(boundedSelection(100,99000,0,2,100000,2),{
    start:100,end:99000,columnStart:0,columnEnd:2,
  });
  assert.deepEqual(extendSelection({row:520,col:1},500,0,100000,2),{
    start:500,end:521,columnStart:0,columnEnd:2,
  });
  assert.equal(boundedSelection(-1,100,0,2,1000,2),null);
  assert.equal(boundedSelection(0,1001,0,2,1000,2),null);
});
test("TSV parser preserves escaped quotes, tabs and embedded linebreaks",()=>{
  assert.deepEqual(parseClipboardTsv('one\t"two\tinside"\n"line\nnext"\t"say ""hello"""\n'),[
    ["one","two\tinside"],["line\nnext",'say "hello"'],
  ]);
  assert.throws(()=>parseClipboardTsv('"unclosed'),/unterminated/);
});
test("large clipboard paste uses global absolute rows, not just loaded DOM rows",()=>{
  const op=makeRangePaste("A\t100\nB\t200",selected,cols,100000,
    (col,text)=>col.type==="number"?Number(text):text);
  assert.deepEqual(op,{kind:"paste",start:500,columnIds:["name","amount"],
    rows:[["A",100],["B",200]]});
  assert.throws(()=>makeRangePaste("X\nY",{...selected,start:99999,columnStart:0},cols,100000,
    (c,t)=>t),/insert more rows/);
  assert.throws(()=>makeRangePaste("A\tB\tC",selected,cols,100000,(c,t)=>t),/final visible column/);
});
test("clipboard response must echo all four global selection boundaries",()=>{
  const req=copyRequestFor("dataset",8,selected);
  const ok={...req,text:"A\tB"};
  assert.equal(matchesCopyResponse(ok,req),true);
  assert.equal(matchesCopyResponse({...ok,requestId:7},req),false);
  assert.equal(matchesCopyResponse({...ok,end:300},req),false);
  assert.equal(matchesCopyResponse({...ok,text:null},req),false);
});
test("undo and redo history references transaction receipts after reload",()=>{
  const state=initialHistory("session");
  const one=nextHistory(state,"edit",1);
  const two=nextHistory(one,"edit",2);
  const undone=nextHistory(two,"undo",3);
  assert.deepEqual(undone.undo,[1]);
  assert.deepEqual(undone.redo,[3]);
  const redone=nextHistory(undone,"redo",4);
  assert.deepEqual(redone.undo,[1,4]);
  assert.deepEqual(redone.redo,[]);
  const map=new Map();
  const storage={
    getItem:(k)=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,v),
  };
  const key=historyStorageKey("grid","dataset");
  saveHistory(storage,key,redone);
  assert.deepEqual(loadHistory(storage,key,"session"),redone);
  assert.deepEqual(loadHistory(storage,key,"other"),initialHistory("other"));
});
