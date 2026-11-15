/* Track preparation cost of bounded ReactGrid windows over browser-resident
 * numeric tables. This benchmark does not include DOM/layout; Chrome tests
 * exercise the real renderer separately.
 */
import { performance } from "node:perf_hooks";
import { NumericRows } from "../src/lib/numericData.js";
import { virtualRowWindow } from "../src/lib/serverVirtual.js";
import { buildClientVirtualRows } from "../src/lib/clientVirtual.js";
import { compileGridColumns } from "../src/lib/gridRows.js";

const width=8;
const columns=Array.from({length:width},(_,i)=>({
  columnId:String(i),title:String(i),type:"number",
}));
const descriptors=compileGridColumns(columns,columns,"en-GB");
const sizes=[100_000,500_000,1_000_000];
for(const n of sizes){
  const matrix=new Float64Array(n*width);
  const rowIds=Array.from({length:n},(_,i)=>i);
  const table={data:new NumericRows(matrix,n,width,"float64"),rowIds};
  const started=performance.now();
  let cells=0;
  for(const fraction of [0,.25,.5,.75,1]){
    const position=fraction*Math.max(0,Math.min(n*25,20_000_000)-420);
    const range=virtualRowWindow(position,n,25,120,420);
    const rows=buildClientVirtualRows({
      table,range,rowHeight:25,viewportHeight:420,columns,descriptors,
      allColumns:columns,newRow:null,readOnly:false,locked:new Set(),
      styleHeader:{},showGhost:false,openDropdown:null,
    });
    if(rows.length>range.size+3) throw Error("Row window exceeded bound");
    cells+=rows.reduce((sum,row)=>sum+row.cells.length,0);
  }
  const ms=Math.round((performance.now()-started)*10)/10;
  const heapMB=Math.round(process.memoryUsage().heapUsed/1048576);
  console.log(JSON.stringify({rows:n,columns:width,preparedCells:cells,
    elapsedMs:ms,heapMB}));
}
