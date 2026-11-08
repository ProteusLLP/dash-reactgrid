import {test} from "node:test";
import assert from "node:assert/strict";
import {clipboardStreamUrl, writeStreamedClipboard} from "../virtualClipboard.js";

test("streaming clipboard URL preserves visible selection and hidden-column ordering",()=>{
  const url=clipboardStreamUrl("/clipboard.tsv?tenant=a","portfolio-v3",
    {start:0,end:250000,columnStart:0,columnEnd:2},
    [{columnId:"name"},{columnId:"amount"}]);
  const parsed=new URL(url,"https://grid.example");
  assert.equal(parsed.searchParams.get("tenant"),"a");
  assert.equal(parsed.searchParams.get("datasetId"),"portfolio-v3");
  assert.equal(parsed.searchParams.get("start"),"0");
  assert.equal(parsed.searchParams.get("end"),"250000");
  assert.deepEqual(JSON.parse(parsed.searchParams.get("columnIds")),["name","amount"]);
});

test("clipboard write starts before awaited fetch and keeps a promised Blob",async()=>{
  let resolveFetch;
  const sequence=[];
  const clipboard={write:items=>{
    sequence.push("write");
    assert.equal(items.length,1);
    return Promise.resolve();
  }};
  class Item { constructor(map){this.map=map;sequence.push("item");} }
  const fetcher=(url,options)=>{
    sequence.push("fetch");
    assert.equal(options.credentials,"same-origin");
    return new Promise(resolve=>{resolveFetch=resolve;});
  };
  const result=writeStreamedClipboard({
    url:"/clipboard.tsv",clipboard,ClipboardItemCtor:Item,fetcher,
  });
  assert.deepEqual(sequence,["fetch","item","write"]);
  await result;
  resolveFetch({ok:true,blob:async()=>new Blob(["A\\t1\\r\\nB\\t2"],{type:"text/plain"})});
});

test("write reports unavailable clipboard and upstream failures",async()=>{
  assert.throws(()=>writeStreamedClipboard({
    url:"/clipboard",clipboard:null,ClipboardItemCtor:null,fetcher:null,
  }),/browser cannot stream/);
  let data;
  class Item {constructor(value){data=value["text/plain"]}}
  const promise=writeStreamedClipboard({
    url:"/clipboard",clipboard:{write:()=>Promise.resolve()},
    ClipboardItemCtor:Item,fetcher:async()=>({ok:false,status:403}),
  });
  await promise;
  await assert.rejects(data,/HTTP 403/);
});
