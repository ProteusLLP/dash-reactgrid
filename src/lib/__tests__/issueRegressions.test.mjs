import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleGridColumns, resizeGridColumns, compileGridColumns, buildGridRows } from "../gridRows.js";
import { parseClipboardTsv, makeRangePaste } from "../virtualOperations.js";
import { pastedValue } from "../model.js";

const cols=[
  {columnId:"text",type:"text",title:"Text",width:120},
  {columnId:"fixed",type:"text",title:"Fixed",nonEditable:true,width:150},
  {columnId:"hidden",type:"number",title:"Hidden",width:80,resizable:false},
];
test("resizing preserves hidden columns and respects opt-outs",()=>{
  const shown=visibleGridColumns(cols,["hidden"]);
  assert.deepEqual(shown.map(c=>c.columnId),["text","fixed"]);
  assert.ok(shown.every(c=>c.resizable===true));
  assert.equal(cols[0].resizable,undefined);
  const next=resizeGridColumns(cols,"text",225);
  assert.equal(next[0].width,225);
  assert.equal(next[1],cols[1]);
  assert.equal(resizeGridColumns(next,"hidden",230)[2].width,80);
  assert.equal(resizeGridColumns(cols,"text",NaN),cols);
});
test("blank TSV paste clears text and numeric destinations",()=>{
  assert.deepEqual(parseClipboardTsv("\t\nA\t"),[["",""],["A",""]]);
  const parsers={number:{parse:Number},percent:{parse:Number}};
  const cols2=[{columnId:"text",type:"text"},{columnId:"n",type:"number"}];
  const op=makeRangePaste("\t",{start:0,end:1,columnStart:0,columnEnd:2},
    cols2,4,(col,val)=>pastedValue(col,{type:"text",text:val},parsers));
  assert.deepEqual(op.rows,[["",null]]);
});
test("virtual range paste refuses protected columns",()=>{
  assert.throws(()=>makeRangePaste("ok\twrong",{start:0,end:1,columnStart:0,columnEnd:2},
    cols,10,(_col,text)=>text),/non-editable/);
});
test("ghost row carries noneditable column metadata",()=>{
  const visible=visibleGridColumns(cols,["hidden"]);
  const built=buildGridRows({
    columns:visible,descriptors:compileGridColumns(visible,cols,"en-GB"),allColumns:cols,
    data:[["Current","Protected",4]],rowIds:["r1"],newRow:null,
    readOnly:false,locked:new Set(),styleHeader:null,showGhost:true,openDropdown:null,
  });
  assert.equal(built.rows.at(-1).cells[1].nonEditable,true);
});
