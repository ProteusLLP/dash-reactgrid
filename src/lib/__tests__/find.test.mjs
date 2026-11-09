import {test} from "node:test";
import assert from "node:assert/strict";
import {cellMatches,findNextCell,matchesFindResponse,resolveFindCursor} from "../find.js";
import {virtualScrollTopForRow,virtualRowWindow} from "../serverVirtual.js";

const all = [
  {columnId:"id",type:"text",title:"ID"},
  {columnId:"secret",type:"text",title:"Hidden"},
  {columnId:"state",type:"dropdown",title:"State",
   values:[{value:"p",label:"Pending review"},{value:"c",label:"Closed"}]},
  {columnId:"value",type:"number",title:"Value"},
];
const shown = [all[0],all[2],all[3]];
const data = [["first","secret match","p",1],["second","hidden","c",42],
  ["find this","ignored","p",4],["last","find","c",42]];

test("Ctrl+F finds hidden-page matches but skips hidden columns",()=>{
  const first = findNextCell(data,all,shown,"find");
  assert.deepEqual(first,{row:2,col:0,columnId:"id"});
  assert.deepEqual(findNextCell(data,all,shown,"find",2,0),first);
  assert.deepEqual(findNextCell(data,all,shown,"no match"),null);
});

test("find wraps in both directions and excludes current cell until wrap",()=>{
  assert.deepEqual(findNextCell(data,all,shown,"42",1,2,1),
    {row:3,col:2,columnId:"value"});
  assert.deepEqual(findNextCell(data,all,shown,"42",3,2,1),
    {row:1,col:2,columnId:"value"});
  assert.deepEqual(findNextCell(data,all,shown,"42",1,2,-1),
    {row:3,col:2,columnId:"value"});
  assert.deepEqual(findNextCell(data,all,shown,"42",-1,-1,-1),
    {row:3,col:2,columnId:"value"});
});

test("search compares displayed dropdown label as well as stored value",()=>{
  assert.deepEqual(findNextCell(data,all,shown,"pending"),
    {row:0,col:1,columnId:"state"});
  assert.equal(cellMatches("p",all[2],"PENDING"),true);
  assert.equal(cellMatches("p",all[2],"pending",true),false);
  assert.equal(cellMatches(true,{type:"checkbox"},"true"),true);
  assert.equal(cellMatches(null,all[0],"null"),false);
  assert.equal(findNextCell([],all,shown,"x"),null);
});

test("virtual search rejects stale or mismatched responses",()=>{
  const pending={datasetId:"new",requestId:22,query:"needle"};
  assert.equal(matchesFindResponse({...pending,rowIndex:99999},pending),true);
  assert.equal(matchesFindResponse({...pending,requestId:21},pending),false);
  assert.equal(matchesFindResponse({...pending,datasetId:"old"},pending),false);
  assert.equal(matchesFindResponse({...pending,query:"old"},pending),false);
});

test("offscreen match navigation is inside the requested bounded viewport",()=>{
  for(const total of [100_000,10_000_000]){
    for(const row of [0,1,505,50_000,total-2,total-1]){
      if(row>=total)continue;
      const scrollTop=virtualScrollTopForRow(row,total,25,400);
      const viewport=virtualRowWindow(scrollTop,total,25,120,400);
      assert.ok(row>=viewport.start && row<viewport.end,
        `row ${row} not in [${viewport.start},${viewport.end}) at ${scrollTop}`);
    }
  }
});

test("search cursor follows its stable column ID when earlier columns hide",()=>{
  const cursor={row:1,col:2,columnId:"value"};
  assert.deepEqual(resolveFindCursor(cursor,shown),{row:1,col:2});
  const reduced=[shown[2]];
  assert.deepEqual(resolveFindCursor(cursor,reduced),{row:1,col:0});
  assert.deepEqual(findNextCell(data,all,reduced,"42",1,0,1),
    {row:3,col:0,columnId:"value"});
  assert.equal(resolveFindCursor(cursor,[shown[0],shown[1]]),null);
  assert.equal(resolveFindCursor(null,shown),null);
});

test("find preserves whitespace and Unicode case mapping",()=>{
  const column={columnId:"name",type:"text"};
  assert.equal(cellMatches("Anne",column,"Ann "),false);
  assert.equal(cellMatches("Ann Marie",column,"Ann "),true);
  assert.equal(cellMatches("Ann Marie",column," "),true);
  assert.equal(cellMatches("Straße",column,"SS"),false);
  assert.equal(cellMatches("Straße",column,"STRAßE"),true);
  assert.deepEqual(findNextCell([["Anne"],["Ann Marie"]],[column],[column],"Ann "),
    {row:1,col:0,columnId:"name"});
  assert.deepEqual(findNextCell([["Anne"],["Ann Marie"]],[column],[column]," "),
    {row:1,col:0,columnId:"name"});
});

test("compressed virtual scroll targets exact rows despite rounded browser coordinates",()=>{
  const total=102_000_000;
  for(const target of [0,1,59,60,61,100,599_999,55_555_555,total-121,total-1]){
    const scrollTop=virtualScrollTopForRow(target,total,25,400);
    for(const browserTop of [scrollTop,Math.floor(scrollTop),Math.ceil(scrollTop),
                             Math.round(scrollTop)]){
      const window=virtualRowWindow(browserTop,total,25,120,400,target);
      assert.ok(window.start<=target && target<window.end,
        `target ${target} excluded from [${window.start},${window.end}) at ${browserTop}`);
      assert.equal(window.end-window.start,120);
    }
  }
  // The ordinary compressed window may miss the row after quantization.
  const target=59;
  const rounded=Math.round(virtualScrollTopForRow(target,total,25,400));
  const regular=virtualRowWindow(rounded,total,25,120,400);
  const anchored=virtualRowWindow(rounded,total,25,120,400,target);
  assert.ok(target<regular.start || target>=regular.end);
  assert.ok(target>=anchored.start && target<anchored.end);
});
