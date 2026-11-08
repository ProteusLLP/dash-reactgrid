import {test} from "node:test";
import assert from "node:assert/strict";
import {
  sheetEdge, keyboardRectangle, keyboardArea, nativeRectangle,
  publicKeyboardRange, keyboardHighlights, fillDownChanges,
  multiEditChanges, keyboardClipboardText, MAX_KEYBOARD_EDIT_CELLS,
} from "../spreadsheetKeyboard.js";

const cols=[
  {columnId:"label",type:"text"},
  {columnId:"count",type:"number"},
  {columnId:"fixed",type:"text",nonEditable:true},
];
const data=[
  ["A",10,"lock 0"],["B",20,"lock 1"],
  ["C",30,"lock 2"],["D",40,"lock 3"],
];
const ids=["a","b","c","d"];
const allow=(rowId,col)=>!col.nonEditable && !(rowId==="c" && col.columnId==="count");

test("Ctrl+Arrows reach absolute data boundaries, excluding header and ghost",()=>{
  assert.deepEqual(sheetEdge("ArrowDown",{row:1,col:1},4,3),{row:3,col:1});
  assert.deepEqual(sheetEdge("ArrowUp",{row:1,col:1},4,3),{row:0,col:1});
  assert.deepEqual(sheetEdge("ArrowRight",{row:1,col:1},4,3),{row:1,col:2});
  assert.deepEqual(sheetEdge("ArrowLeft",{row:1,col:1},4,3),{row:1,col:0});
  assert.equal(sheetEdge("ArrowDown",{row:0,col:0},0,3),null);
  assert.equal(sheetEdge("Home",{row:0,col:0},4,3),null);
});

test("Ctrl+Shift selection is compact and reverses direction correctly",()=>{
  const a={row:2,col:1};
  assert.deepEqual(keyboardRectangle(a,{row:0,col:0}),
    {start:0,end:3,columnStart:0,columnEnd:2});
  assert.equal(keyboardArea(keyboardRectangle(a,{row:3,col:1})),2);
  const rect=keyboardRectangle(a,{row:0,col:0});
  const published=publicKeyboardRange(rect,ids,cols);
  assert.deepEqual(published.rows.map(r=>r.rowId),["a","b","c"]);
  assert.equal(published.first.row.idx,1);
  assert.equal(published.last.column.columnId,"count");
  assert.equal(keyboardHighlights(rect,ids,cols,0,2).length,4);
  assert.equal(keyboardHighlights(rect,ids,cols,0,2,1).length,0);
});

test("page-local ReactGrid ranges map to global row positions",()=>{
  const range={first:{row:{idx:1},column:{idx:1}},
    last:{row:{idx:3},column:{idx:2}}};
  assert.deepEqual(nativeRectangle([range],30,200,3),
    {start:30,end:33,columnStart:1,columnEnd:3});
  assert.deepEqual(nativeRectangle(null,0,4,3,{row:1,col:2}),
    {start:1,end:2,columnStart:2,columnEnd:3});
});

test("Ctrl+D copies top row per column, skipping protected destinations",()=>{
  const r={start:0,end:4,columnStart:0,columnEnd:3};
  const edits=fillDownChanges(r,data,ids,cols,cols,allow);
  assert.deepEqual(edits,[
    {rowId:"b",columnId:"label",value:"A"},
    {rowId:"b",columnId:"count",value:10},
    {rowId:"c",columnId:"label",value:"A"},
    {rowId:"d",columnId:"label",value:"A"},
    {rowId:"d",columnId:"count",value:10},
  ]);
  const only={start:1,end:2,columnStart:0,columnEnd:1};
  assert.deepEqual(fillDownChanges(only,data,ids,cols,cols,allow),
    [{rowId:"b",columnId:"label",value:"A"}]);
  assert.deepEqual(fillDownChanges({...only,start:0,end:1},data,ids,cols,cols,allow),[]);
  assert.throws(()=>fillDownChanges(
    {start:0,end:50000,columnStart:0,columnEnd:2},
    data,ids,cols,cols,allow),/20,000 cells/);
});

test("Shift+Enter broadcasts edited values with target type and locked cell checks",()=>{
  const rect={start:1,end:4,columnStart:0,columnEnd:3};
  const edits=multiEditChanges(rect,
    {newCell:{type:"text",text:"12.5"}},cols[0],
    row=>({rowId:ids[row],values:data[row]}),
    cols,allow,{number:{parse:Number},percent:{parse:Number}});
  assert.deepEqual(edits,[
    {rowId:"b",columnId:"label",value:"12.5"},
    {rowId:"b",columnId:"count",value:12.5},
    {rowId:"c",columnId:"label",value:"12.5"},
    {rowId:"d",columnId:"label",value:"12.5"},
    {rowId:"d",columnId:"count",value:12.5},
  ]);
  assert.equal(multiEditChanges(
    {start:0,end:1,columnStart:0,columnEnd:1},
    {newCell:{type:"text",text:"X"}},cols[0],
    row=>({rowId:ids[row],values:data[row]}),
    cols,allow,{number:{parse:Number}}),null);
});

test("clipboard of Ctrl+Shift range uses original data and Excel TSV",()=>{
  assert.equal(keyboardClipboardText(
    {start:0,end:2,columnStart:0,columnEnd:2},
    [["A\tB",10],["C",20]],cols,cols),"\"A\tB\"\t10\nC\t20");
  assert.equal(keyboardClipboardText(
    {start:0,end:MAX_KEYBOARD_EDIT_CELLS+1,columnStart:0,columnEnd:1},
    data,cols,cols),null);
  const huge=publicKeyboardRange(
    {start:0,end:50000,columnStart:0,columnEnd:1},
    {0:"a",49999:"last"},cols);
  assert.equal(huge.rows.length,0);
});


test("three grouped header rows preserve native and paged data indices",()=>{
  const native={first:{row:{idx:3},column:{idx:0}},
    last:{row:{idx:5},column:{idx:1}}};
  assert.deepEqual(nativeRectangle([native],0,4,3,null,3),
    {start:0,end:3,columnStart:0,columnEnd:2});
  assert.deepEqual(nativeRectangle([native],30,200,3,null,3),
    {start:30,end:33,columnStart:0,columnEnd:2});
  const full={first:{row:{idx:0},column:{idx:0}},
    last:{row:{idx:5},column:{idx:1}}};
  assert.deepEqual(nativeRectangle([full],30,200,3,null,3),
    {start:30,end:33,columnStart:0,columnEnd:2},
    "select all on a later page cannot include rows from the previous page");
  assert.equal(nativeRectangle([{
    first:{row:{idx:0},column:{idx:0}},
    last:{row:{idx:2},column:{idx:1}},
  }],30,200,3,null,3),null);
  const p=publicKeyboardRange({
    start:30,end:33,columnStart:0,columnEnd:2,
  },{30:"r30",31:"r31",32:"r32"},cols,3,30);
  assert.equal(p.first.row.idx,3);
  assert.equal(p.last.row.idx,5);
  assert.deepEqual(p.rows.map(x=>x.idx),[3,4,5]);
  assert.deepEqual(p.rows.map(x=>x.rowId),["r30","r31","r32"]);
});
