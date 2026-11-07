/* Contract tests across cell types, clipboard formats and interacting grid features.
 * These tests run without React or a browser: npm run test:js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GHOST_ROW_ID, applyChanges, blankRow, optionsOf, parseText, pastedValue,
  removeRows, textOf, valueOf, rowsInRanges, columnClass, rulesHold,
} from "../model.js";
import { compileGridColumns, buildGridRows, pageBounds, canPasteOnPage } from "../gridRows.js";
import {
  clearSelectedCells, wholeGridRange, selectionText, selectAllRanges,
  focusedRange, pasteStartRow,
} from "../keyboard.js";
import {
  escapeTsvCell, parseClipboardTsv, makeRangePaste, boundedSelection,
  copyRequestFor, matchesCopyResponse, MAX_RANGE_ROWS, MAX_PASTE_CELLS,
  nextHistory, initialHistory,
} from "../virtualOperations.js";

const columns = [
  {columnId:"label", title:"Label", type:"text"},
  {columnId:"quantity", title:"Quantity", type:"number", formatOptions:{maximumFractionDigits:2}},
  {columnId:"custom", title:"Custom", type:"customnumber"},
  {columnId:"ratio", title:"Ratio", type:"percent", formatOptions:{maximumFractionDigits:1}},
  {columnId:"status", title:"Status", type:"dropdown", values:[
    {label:"In progress",value:"open"},{label:"Finished",value:"closed"}]},
  {columnId:"flag", title:"Flag", type:"checkbox"},
  {columnId:"date", title:"Date", type:"date", formatOptions:{dateStyle:"short"}},
  {columnId:"time", title:"Time", type:"time", formatOptions:{timeStyle:"short"}},
  {columnId:"dependent", title:"Dependent", type:"text",
    editableWhen:[{columnId:"status",in:["open"]},{columnId:"flag",truthy:true}]},
  {columnId:"fixed", title:"Fixed", type:"text", nonEditable:true},
  {columnId:"internal", title:"Hidden", type:"text"},
];
const visible = columns.filter(col=>col.columnId!=="internal");
const data = [
  ["A",12.5,1.25,0.325,"open",true,"2026-10-31","2026-10-31T13:45:00Z","enabled","fixed","secret-a"],
  ["B",0,null,null,"closed",false,null,null,"blocked","fixed","secret-b"],
];
const parsers = {
  number:{parse:s=>Number(String(s).replaceAll(",",""))},
  percent:{parse:s=>Number(String(s).replace("%",""))/100},
};
const render = (overrides={}) => buildGridRows({
  columns:visible, allColumns:columns,
  descriptors:compileGridColumns(visible,columns,"en-GB"),
  data, rowIds:["r1","r2"], newRow:{status:"open",flag:true},
  readOnly:false, locked:new Set(["r1\u0000quantity"]),
  showGhost:true, openDropdown:null, ...overrides,
});

test("all supported built-in cell types and customnumber produce the expected ReactGrid cells",()=>{
  const {rows}=render();
  const cells=rows[1].cells;
  assert.deepEqual(cells.map(x=>x.type),[
    "text","customnumber","text","percent","dropdown","checkbox",
    "date","time","text","text",
  ]);
  // The customnumber column currently falls through the renderer to text.
  // See the expected-failure browser test for its direct-editing regression.
  assert.equal(cells[0].text,"A");
  assert.equal(cells[1].value,12.5);
  assert.equal(cells[3].value,0.325);
  assert.equal(cells[4].selectedValue,"open");
  assert.deepEqual(cells[4].values,[
    {label:"In progress",value:"open"},{label:"Finished",value:"closed"},
  ]);
  assert.equal(cells[5].checked,true);
  assert.ok(cells[6].date instanceof Date);
  assert.ok(cells[7].time instanceof Date);
  assert.equal(cells[6].date.toISOString().slice(0,10),"2026-10-31");
  assert.equal(cells[2].text,"1.25");
  assert.equal(rows[2].cells[6].date,undefined);
  assert.equal(rows[2].cells[7].time,undefined);
  assert.equal(rows[0].cells.length,10,"hidden columns do not enter the DOM");
});

test("cell values from editing use correct types, including blank numeric and dates",()=>{
  const expectations=[
    ["text",{text:"new"},"new"],
    ["number",{value:3.25},3.25],
    ["customnumber",{value:14},14],
    ["percent",{value:0.125},0.125],
    ["dropdown",{selectedValue:"closed"},"closed"],
    ["checkbox",{checked:false},false],
    ["date",{date:"2026-12-01"},"2026-12-01"],
    ["time",{time:"2026-12-01T17:00:00Z"},"2026-12-01T17:00:00Z"],
  ];
  for(const [type,cell,expected] of expectations){
    assert.deepEqual(valueOf({type},cell),expected,type);
  }
  for(const type of ["number","customnumber","percent"]){
    assert.equal(valueOf({type},{value:NaN}),null);
    assert.equal(valueOf({type},{value:Infinity}),null);
  }
  assert.equal(valueOf({type:"dropdown"},{}),null);
  assert.equal(valueOf({type:"text"},{}),"");
});

test("Excel-compatible paste converts values using target column types",()=>{
  const input=[
    ["number","1,234.5",1234.5],
    ["customnumber","-3.25",-3.25],
    ["number","",null],
    ["number","invalid",null],
    ["percent","35%",0.35],
    ["percent","0.35",0.35],
    ["percent","",null],
    ["checkbox","TRUE",true],
    ["checkbox","YeS",true],
    ["checkbox","0",false],
    ["dropdown","In progress","open"],
    ["dropdown","closed","closed"],
    ["dropdown","nonexistent",null],
    ["date","2026-11-01","2026-11-01"],
    ["time","14:30","14:30"],
    ["text"," a\tb "," a\tb "],
  ];
  for(const [type,text,expected] of input) {
    const column=columns.find(c=>c.type===type)||{type};
    assert.deepEqual(parseText(column,text,parsers),expected,type+":"+text);
  }
  assert.equal(pastedValue(columns[3],{type:"percent",value:0.11,text:"11%"},parsers),0.11);
  assert.equal(pastedValue(columns[5],{type:"checkbox",checked:true,text:"FALSE"},parsers),true);
  assert.equal(pastedValue(columns[4],{type:"dropdown",selectedValue:"closed"},parsers),"closed");
});

test("Excel TSV round-trips Unicode, multiline text, quotes and empty fields",()=>{
  const values=[
    ["quoted \u0022value\u0022","has\ttab","a\nb","£1,234.50"],
    ["","comma,here","emoji 😀"," leading and trailing "],
  ];
  const text=values.map(row=>row.map(escapeTsvCell).join("\t")).join("\r\n")+"\r\n";
  assert.deepEqual(parseClipboardTsv(text),values);
  assert.deepEqual(parseClipboardTsv("A\tB\r\nC\tD\r\n"),[["A","B"],["C","D"]]);
  assert.throws(()=>parseClipboardTsv('"never closed'),/unterminated/);
});

test("whole-grid copy includes headers but excludes the extension row and respects hidden columns",()=>{
  const {rows}=render();
  const selected=wholeGridRange(rows,visible);
  const copied=selectionText(rows,[selected],textOf);
  const parsed=parseClipboardTsv(copied);
  assert.equal(parsed.length,3);
  assert.equal(parsed[0].length,visible.length);
  assert.equal(parsed[0][0],"Label");
  assert.equal(parsed[1][0],"A");
  assert.equal(parsed[1][3],"0.325");
  assert.equal(parsed[1][5],"TRUE");
  assert.equal(parsed[2][5],"FALSE");
  assert.ok(!copied.includes("secret-a"));
  assert.equal(parsed[1].length,10);
  assert.equal(selectAllRanges([focusedRange(rows,visible,{rowId:"r2",columnId:"flag"})],
    rows,visible,{rowId:"r2",columnId:"flag"})[0].rows.length,4);
  assert.equal(pasteStartRow(selected),0);
});

test("all cell edit types can be batched without modifying original rows",()=>{
  const table={data,rowIds:["r1","r2"]};
  const edits=[
    {rowId:"r1",columnId:"label",value:"Renamed"},
    {rowId:"r1",columnId:"quantity",value:99},
    {rowId:"r1",columnId:"ratio",value:0.4},
    {rowId:"r1",columnId:"status",value:"closed"},
    {rowId:"r1",columnId:"flag",value:false},
    {rowId:"r1",columnId:"date",value:"2026-12-25"},
    {rowId:"r1",columnId:"time",value:"2026-12-25T08:15:00Z"},
  ];
  const next=applyChanges(table,edits,{columns});
  assert.deepEqual(next.edits.map(e=>e.columnId),edits.map(e=>e.columnId));
  assert.equal(next.data[0][0],"Renamed");
  assert.equal(next.data[0][6],"2026-12-25");
  assert.equal(data[0][0],"A");
  assert.strictEqual(next.data[1],data[1],"untouched rows remain shared");
  assert.strictEqual(next.rowIds,table.rowIds);
});

test("editableWhen, lockedCells, readOnly and hidden columns combine correctly",()=>{
  const {rows}=render();
  assert.equal(rows[1].cells[8].nonEditable,false);
  assert.equal(rows[2].cells[8].nonEditable,true);
  assert.match(rows[2].cells[8].className,/rg-cell-na/);
  assert.equal(rows[1].cells[1].nonEditable,true);
  assert.equal(rows[1].cells[9].nonEditable,true);
  assert.equal(rows[1].cells[5].nonEditable,false);
  assert.match(rows[1].cells[0].className,/rg-col-label/);
  const readOnly=render({readOnly:true}).rows;
  assert.ok(readOnly.slice(1).every(row=>row.cells.every(cell=>cell.nonEditable)));
  assert.equal(rulesHold(columns[8],data[0],columns.map(c=>c.columnId)),true);
  assert.equal(rulesHold(columns[8],data[1],columns.map(c=>c.columnId)),false);
});

test("Delete clears only editable cells, not headers, conditional cells or ghost",()=>{
  const {rows}=render();
  const changes=clearSelectedCells(rows,visible,[wholeGridRange(rows,visible)]);
  const keys=new Set(changes.map(x=>x.rowId+":"+x.columnId));
  assert.ok(keys.has("r1:label"));
  assert.ok(keys.has("r1:flag"));
  assert.ok(keys.has("r2:label"));
  assert.ok(!keys.has("r1:quantity"));
  assert.ok(!keys.has("r1:fixed"));
  assert.ok(!keys.has("r2:dependent"));
  assert.ok(![...keys].some(k=>k.startsWith(GHOST_ROW_ID)));
  assert.equal(changes.find(x=>x.rowId==="r1"&&x.columnId==="flag").value,false);
  assert.equal(changes.find(x=>x.rowId==="r2"&&x.columnId==="ratio").value,null);
});

test("ghost paste extends by several rows and retains default values",()=>{
  let i=0;
  const changes=[
    {rowId:{ghost:0},columnId:"label",value:"First"},
    {rowId:{ghost:0},columnId:"quantity",value:10},
    {rowId:{ghost:1},columnId:"label",value:"Second"},
    {rowId:{ghost:1},columnId:"ratio",value:0.15},
    {rowId:{ghost:2},columnId:"label",value:""},
  ];
  const next=applyChanges({data,rowIds:["r1","r2"]},changes,{
    columns,newRow:{status:"open",flag:true,internal:"origin"},
    makeId:()=> "new-"+(++i),
  });
  assert.equal(next.data.length,4);
  assert.deepEqual(next.data[2],["First",10,null,null,"open",true,null,null,null,null,"origin"]);
  assert.deepEqual(next.data[3],["Second",null,null,0.15,"open",true,null,null,null,null,"origin"]);
  assert.deepEqual(next.edits.filter(e=>e.kind==="add").map(e=>e.rowId),["new-1","new-2"]);
  assert.deepEqual(blankRow(columns,{flag:false})[5],false);
  assert.equal(removeRows(next,["new-1","new-1"]).data.length,3);
});

test("global virtual copy and paste preserve visible-column mapping",()=>{
  const selection=boundedSelection(90_000,90_002,1,3,200_000,visible.length);
  const req=copyRequestFor("dataset",42,selection,visible);
  assert.deepEqual(req.columnIds,["quantity","custom"]);
  assert.equal(matchesCopyResponse({...req,text:"1\t2"},req),true);
  assert.equal(matchesCopyResponse({...req,columnIds:["custom","quantity"],text:"1\t2"},req),false);
  const op=makeRangePaste("12.5\t14\n20\t21",selection,visible,200_000,
    (column,value)=>pastedValue(column,{type:"text",text:value},parsers));
  assert.deepEqual(op,{kind:"paste",start:90_000,columnIds:["quantity","custom"],
    rows:[[12.5,14],[20,21]]});
  assert.throws(()=>makeRangePaste("1\t2\n3",selection,visible,200_000,
    (_,v)=>v),/inconsistent/);
});

test("large virtual selections remain compact and bound copy/paste commands",()=>{
  const selection=boundedSelection(0,1_000_000,0,visible.length,1_000_000,visible.length);
  assert.equal(Object.keys(selection).length,4);
  assert.equal(selection.end,1_000_000);
  const maxRows="x\n".repeat(MAX_RANGE_ROWS+1);
  assert.throws(()=>makeRangePaste(maxRows,{...selection,start:0},visible,1_000_000,
    (_,v)=>v),/permitted batch/);
  const tooWide="x\t".repeat(MAX_PASTE_CELLS+1);
  assert.throws(()=>makeRangePaste(tooWide,{...selection,start:0},visible,1_000_000,
    (_,v)=>v),/permitted batch|final visible column/);
  const first=pageBounds(1001,250,0);
  assert.equal(canPasteOnPage(250,first,250),false);
  assert.equal(canPasteOnPage(249,first,250),true);
});

test("row deletion, undo references and new edits clear redo history",()=>{
  const table={data,rowIds:["r1","r2"]};
  const pruned=removeRows(table,["r2","r2","missing"]);
  assert.deepEqual(pruned.rowIds,["r1"]);
  assert.deepEqual(pruned.edits,[{kind:"remove",rowIds:["r2"]}]);
  const start=initialHistory("stream");
  const one=nextHistory(start,"edit",1);
  const two=nextHistory(one,"edit",2);
  const undo=nextHistory(two,"undo",3);
  assert.deepEqual(undo,{streamId:"stream",undo:[1],redo:[3]});
  assert.deepEqual(nextHistory(undo,"edit",4).redo,[]);
  assert.deepEqual(nextHistory(undo,"redo",5).undo,[1,5]);
});

test("column definitions retain type identities and predictable option/text classes",()=>{
  assert.deepEqual(optionsOf({values:["yes",{label:"Not set",value:null}]}),[
    {label:"yes",value:"yes"},{label:"Not set",value:null},
  ]);
  assert.equal(columnClass("a.b/c"),"rg-col-a_b_c");
  assert.equal(textOf({type:"checkbox",checked:true}),"TRUE");
  assert.equal(textOf({type:"customnumber",value:1234.125}),"1234.125");
  assert.equal(textOf({type:"percent",value:0.125}),"0.125");
  assert.equal(textOf({type:"dropdown",selectedValue:"open"}),"open");
  assert.equal(textOf({type:"text",text:"text"}),"text");
});
