import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIRTUAL_ROW_HEIGHT, MAX_BROWSER_SCROLL_PX,
  VIRTUAL_SPACER_TOP, VIRTUAL_SPACER_BOTTOM, VIRTUAL_LOADING_PREFIX,
  virtualRowWindow, viewportKey, validViewportResponse, addViewportCache,
  buildVirtualRows,
} from "../serverVirtual.js";
import { compileGridColumns } from "../gridRows.js";

const cols = [
  {columnId:"name",title:"Name",type:"text"},
  {columnId:"value",title:"Value",type:"number"},
  {columnId:"eligible",title:"Eligible",type:"checkbox",
    editableWhen:[{columnId:"name",in:["valid"]}]},
];
const descriptors=compileGridColumns(cols,cols,"en-GB");

test("scroll position maps to bounded server windows at top, middle and bottom",()=>{
  const first=virtualRowWindow(0,100000,25,120,400);
  assert.equal(first.start,0);
  assert.equal(first.end,120);
  assert.equal(first.first,0);
  const middle=virtualRowWindow(1_250_000,100000,25,120,400);
  assert.ok(middle.first >= 49900 && middle.first <= 50100);
  assert.ok(middle.first >= middle.start && middle.first < middle.end);
  assert.equal(middle.end-middle.start,120);
  const bottom=virtualRowWindow(3_000_000,100000,25,120,400);
  assert.equal(bottom.end,100000);
  assert.equal(bottom.start,99880);
  assert.equal(bottom.first,99982);
});

test("adjacent scroll positions reuse the same window to avoid request storms",()=>{
  const p=virtualRowWindow(100_000,100000,25,120,400);
  const q=virtualRowWindow(100_001,100000,25,120,400);
  assert.deepEqual({start:p.start,end:p.end},{start:q.start,end:q.end});
});

test("a 100k-row grid materializes at most a small window plus spacers",()=>{
  const range=virtualRowWindow(1_000_000,100000,25,120,400);
  const page={
    rowIds:Array.from({length:range.end-range.start},(_,j)=>"id-"+(range.start+j)),
    data:Array.from({length:range.end-range.start},(_,j)=>["valid",range.start+j,true]),
  };
  const rows=buildVirtualRows({
    columns:cols,descriptors,allColumns:cols,rowCount:100000,
    range,page,rowHeight:25,readOnly:false,locked:new Set(),
  });
  assert.equal(rows.length,123);
  assert.equal(rows[0].rowId,"header");
  assert.equal(rows[1].rowId,VIRTUAL_SPACER_TOP);
  assert.equal(rows.at(-1).rowId,VIRTUAL_SPACER_BOTTOM);
  assert.equal(rows[2].rowId,"id-"+range.start);
  assert.equal(rows.at(-2).rowId,"id-"+(range.end-1));
  assert.equal(rows[2].cells[2].nonEditable,false,"editableWhen uses loaded row values");
  const totalHeight=rows.slice(1).reduce((v,r)=>v+r.height,0);
  assert.ok(Math.abs(totalHeight-100000*25)<0.001);
});

test("unfetched rows are visible but noneditable loading placeholders",()=>{
  const range=virtualRowWindow(1000,2000,25,60,400);
  const rows=buildVirtualRows({
    columns:cols,descriptors,allColumns:cols,rowCount:2000,
    range,page:null,rowHeight:25,readOnly:false,locked:new Set(),
  });
  const loading=rows.find(row=>row.rowId.startsWith(VIRTUAL_LOADING_PREFIX));
  assert.equal(loading.cells[0].text,"Loading…");
  assert.ok(loading.cells.every(cell=>cell.nonEditable));
});

test("server row response is accepted only when it exactly matches the request",()=>{
  const request={datasetId:"pricing-v2",requestId:19,start:120,end:122};
  const response={...request,rowIds:["r120","r121"],
    data:[["valid",1,true],["valid",2,false]]};
  assert.equal(validViewportResponse(response,request,cols),true);
  assert.equal(validViewportResponse({...response,requestId:18},request,cols),false);
  assert.equal(validViewportResponse({...response,datasetId:"old"},request,cols),false);
  assert.equal(validViewportResponse({...response,start:0},request,cols),false);
  assert.equal(validViewportResponse({...response,rowIds:["same","same"]},request,cols),false);
  assert.equal(validViewportResponse({...response,data:[response.data[0]]},request,cols),false);
  assert.equal(validViewportResponse({...response,data:[[1],response.data[1]]},request,cols),false);
  assert.equal(validViewportResponse({...response,rowIds:[{},null]},request,cols),false);
});

test("numeric row IDs must be JavaScript-safe integers",()=>{
  const request={datasetId:"dataset",requestId:4,start:0,end:2};
  const data=[["valid",1,true],["valid",2,false]];
  assert.equal(validViewportResponse({...request,rowIds:[1,2],data},request,cols),true);
  assert.equal(validViewportResponse({...request,rowIds:[Number.MAX_SAFE_INTEGER+1,2],data},request,cols),false);
  assert.equal(validViewportResponse({...request,rowIds:[1.1,2],data},request,cols),false);
  assert.equal(validViewportResponse({...request,rowIds:[
    String(BigInt(Number.MAX_SAFE_INTEGER)+1n),String(BigInt(Number.MAX_SAFE_INTEGER)+2n)],data},request,cols),true);
});

test("capped scrollbar compresses spacers, never the height of loaded rows",()=>{
  const total=10_000_000;
  const viewport=400;
  for (const scrollTop of [0,MAX_BROWSER_SCROLL_PX/2,MAX_BROWSER_SCROLL_PX]) {
    const range=virtualRowWindow(scrollTop,total,25,120,viewport);
    const page={rowIds:Array.from({length:range.end-range.start},(_,i)=>
      "id-"+(range.start+i)),data:Array.from({length:range.end-range.start},
      (_,i)=>["valid",range.start+i,true])};
    const rows=buildVirtualRows({
      columns:cols,descriptors,allColumns:cols,rowCount:total,
      range,page,rowHeight:25,readOnly:false,locked:new Set(),
    });
    const materialized=rows.filter(row=>row.rowId.startsWith("id-"));
    assert.equal(materialized.length,120);
    assert.ok(materialized.every(row=>row.height===25));
    const height=rows.slice(1).reduce((sum,row)=>sum+row.height,0);
    assert.ok(Math.abs(height-MAX_BROWSER_SCROLL_PX)<0.01,
      "full logical table is represented by physical scrollbar height");
    const top=rows.some(row=>row.rowId===VIRTUAL_SPACER_TOP)
      ? rows.find(row=>row.rowId===VIRTUAL_SPACER_TOP).height : 0;
    const bottom=rows.some(row=>row.rowId===VIRTUAL_SPACER_BOTTOM)
      ? rows.find(row=>row.rowId===VIRTUAL_SPACER_BOTTOM).height : 0;
    const available=Math.min(
      Math.max(0,scrollTop),MAX_BROWSER_SCROLL_PX-viewport);
    assert.ok(top<=available+viewport);
    assert.ok(bottom>=0);
  }
  const end=virtualRowWindow(MAX_BROWSER_SCROLL_PX,total,25,120,400);
  assert.equal(end.end,total);
});

test("small LRU cache is bounded and dataset-aware",()=>{
  let cache=new Map();
  for(let i=0;i<6;i++){
    const key=viewportKey("a",i*100,(i+1)*100);
    cache=addViewportCache(cache,key,{data:[[i]],rowIds:["r"+i]});
  }
  assert.equal(cache.size,4);
  assert.equal(cache.has(viewportKey("a",0,100)),false);
  assert.equal(cache.get(viewportKey("a",500,600)).data[0][0],5);
  assert.notEqual(viewportKey("a",0,100),viewportKey("b",0,100));
});

test("large logical scroll heights are bounded for browser CSS pixel limits",()=>{
  const many=virtualRowWindow(10_000_000,10_000_000,25,120,400);
  assert.equal(many.totalHeight,MAX_BROWSER_SCROLL_PX);
  assert.ok(many.first > 0 && many.first < 10_000_000);
  assert.equal(virtualRowWindow(0,0,25,120,400).end,0);
  assert.throws(()=>virtualRowWindow(0,-1),/nonnegative/);
  assert.throws(()=>virtualRowWindow(0,100,0),/positive/);
});

test("virtualized header retains tooltip metadata", () => {
  const columns = [{...cols[0], tooltip:"Full name"}, cols[1], cols[2]];
  const descriptors = compileGridColumns(columns, columns, "en-GB");
  const range = virtualRowWindow(0, 2, 25, 20, 200);
  const rows = buildVirtualRows({
    columns, descriptors, allColumns:columns, rowCount:2, range,
    page:{rowIds:["a","b"],data:[["valid",1,true],["other",2,false]]},
    rowHeight:25, readOnly:false, locked:new Set(),
  });
  assert.equal(rows[0].cells[0].tooltip, "Full name");
  assert.equal(rows[0].cells[1].tooltip, undefined);
});
test("grouped virtual headers stay above spacers without altering row offsets", () => {
  const grouped = cols.map((column,index)=>({
    ...column,headerPath:index<2 ? ["Input","Details"] : ["Output","Flags"],
  }));
  const range=virtualRowWindow(1000,1000,25,60,400);
  const descriptors=compileGridColumns(grouped,grouped,"en-GB");
  const rows=buildVirtualRows({
    columns:grouped,descriptors,allColumns:grouped,rowCount:1000,
    range,page:null,rowHeight:25,readOnly:false,locked:new Set(),
  });
  assert.deepEqual(rows.slice(0,3).map(row=>row.rowId),
    ["header-group-0","header-group-1","header"]);
  assert.equal(rows[0].cells[0].colspan,2);
  const firstData=rows.find(row=>row.rowId.startsWith(VIRTUAL_LOADING_PREFIX));
  assert.ok(firstData);
  assert.equal(firstData.cells.length,grouped.length);
  assert.equal(rows.length,range.end-range.start+5);
});


test("virtual group headers avoid real row ID collisions",()=>{
  const grouped=cols.map((column)=>({...column,headerPath:["Rates"]}));
  const range=virtualRowWindow(0,1,25,20,200);
  const rows=buildVirtualRows({
    columns:grouped,descriptors:compileGridColumns(grouped,grouped,"en-GB"),
    allColumns:grouped,rowCount:1,range,
    page:{rowIds:["header-group-0"],data:[["valid",3,true]]},
    rowHeight:25,readOnly:false,locked:new Set(),
  });
  assert.equal(rows.at(-1).rowId,"header-group-0");
  assert.notEqual(rows[0].rowId,"header-group-0");
});
