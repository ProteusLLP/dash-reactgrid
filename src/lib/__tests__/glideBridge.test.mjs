import test from "node:test";
import assert from "node:assert/strict";
import {
  cellAt, dataRowAt, displayValue, editCell, isDataCell, nativeRange,
  publicLocation,
} from "../glideBridgeModel.js";

const cols=[{columnId:"text"},{columnId:"number"},{columnId:"pct"},
  {columnId:"check"},{columnId:"menu"},{columnId:"date"},
  {columnId:"time"},{columnId:"locked"}];
const date=new Date(2026,10,7);
const time=new Date(2026,10,7,12,30);
const head={rowId:"header",cells:cols.map(x=>({type:"header",text:x.columnId}))};
const row={rowId:"r0",cells:[
  {type:"text",text:"Alpha"},
  {type:"customnumber",value:2.5},
  {type:"percent",value:0.25},
  {type:"checkbox",checked:true},
  {type:"dropdown",selectedValue:"open",values:[
    {value:"open",label:"In progress"},{value:"closed",label:"Finished"}]},
  {type:"date",date},
  {type:"time",time},
  {type:"text",text:"Locked",nonEditable:true},
]};
const rows=[head,row];
test("normal indexing and public selection match ReactGrid header indexing",()=>{
  assert.equal(dataRowAt(rows,0),row);
  assert.equal(cellAt(rows,0,0).text,"Alpha");
  assert.equal(isDataCell(rows,cols,0,0),true);
  assert.equal(isDataCell(rows,cols,0,-1),false);
  assert.deepEqual(publicLocation(rows,cols,0,0),{rowId:"r0",columnId:"text"});
  const sel=nativeRange(rows,cols,{x:0,y:0,width:2,height:1});
  assert.deepEqual(sel[0].first,{row:{idx:1,rowId:"r0"},column:{idx:0,columnId:"text"}});
  assert.equal(sel[0].last.column.columnId,"number");
});

test("display, types and disabled cells preserve existing representation",()=>{
  assert.equal(displayValue(row.cells[0]),"Alpha");
  assert.equal(displayValue(row.cells[4]),"In progress");
  assert.equal(displayValue(row.cells[5]),"2026-11-07");
  assert.equal(displayValue(row.cells[6]),"12:30");
  assert.equal(editCell(row.cells[7],{data:"bad"}),null);
  assert.equal(editCell(row.cells[1],{data:"garbage"}),null);
  assert.equal(editCell(row.cells[4],{data:"bogus"}),null);
});

test("numeric, percentage, dropdown, boolean, date and time edits",()=>{
  assert.equal(editCell(row.cells[1],{data:"-31.25"}).value,-31.25);
  assert.equal(editCell(row.cells[2],{data:"37"}).value,0.37);
  assert.equal(editCell(row.cells[2],{data:"37%"}).value,0.37);
  assert.equal(editCell(row.cells[3],{data:false}).checked,false);
  assert.equal(editCell(row.cells[4],{data:"Finished"}).selectedValue,"closed");
  assert.equal(editCell(row.cells[5],{data:"2026-11-14"}).date.getDate(),14);
  assert.equal(editCell(row.cells[6],{data:"15:45"}).time.getHours(),15);
  assert.equal(editCell(row.cells[5],{data:"2026-02-30"}),null);
  assert.equal(editCell(row.cells[6],{data:"24:10"}),null);
});

test("unloaded virtual placeholders cannot be edited",()=>{
  const placeholder={rowId:"__drg_virtual_loading_55",cells:row.cells};
  assert.equal(isDataCell([head,placeholder],cols,0,0),false);
});
