import test from 'node:test';
import assert from 'node:assert/strict';
import { NumericRows } from '../numericData.js';
import { virtualRowWindow } from '../serverVirtual.js';
import { buildClientVirtualRows, clientClipboardText } from '../clientVirtual.js';
import { compileGridColumns } from '../gridRows.js';

const columns=Array.from({length:8},(_,i)=>({columnId:String(i),title:String(i),type:'number'}));
const descriptors=compileGridColumns(columns,columns,'en-GB');
const tableFor=(count)=>({
  data:new NumericRows(new Float64Array(count*columns.length)
    .map((_,i)=>i),count,columns.length,'float64'),
  rowIds:Array.from({length:count},(_,i)=>i),
});
const rendered=(table,range,extendable=false)=>buildClientVirtualRows({
  table,range,rowHeight:25,viewportHeight:420,columns,descriptors,allColumns:columns,
  locked:new Set(),readOnly:false,styleHeader:{},showGhost:extendable,
  newRow:null,openDropdown:null,
});

test('100k numeric rows remain compact and only a bounded cell matrix is created',()=>{
  const table=tableFor(100_000);
  for(const pos of [0,350_000,1_250_000,2_499_500]){
    const range=virtualRowWindow(pos,table.data.length,25,120,420);
    const rows=rendered(table,range);
    assert.ok(rows.length<=range.size+3);
    assert.equal(rows[0].rowId,'header');
    assert.equal(rows.filter(row=>typeof row.rowId==='number').length,
      range.end-range.start);
    const first=rows.find(row=>row.rowId===range.start);
    assert.equal(first.cells[0].value,range.start*columns.length);
  }
  assert.ok(table.data.cached.size<=1500);
});

test('million row scroll geometry remains bounded with compressed spacers',()=>{
  const table=tableFor(1_000_000);
  const range=virtualRowWindow(19_500_000,table.data.length,25,120,420);
  const rows=rendered(table,range);
  assert.ok(range.start>500_000);
  assert.ok(rows.length<140);
  assert.equal(rows.filter(row=>typeof row.rowId==='number').length,range.end-range.start);
});

test('client viewport reflects edited buffer overrides and permits ghost row',()=>{
  const table=tableFor(1000);
  table.data.setRow(999,[99,2,3,4,5,6,7,8]);
  const range=virtualRowWindow(24_500,table.data.length,25,120,420);
  const rows=rendered(table,range,true);
  assert.equal(rows.find(row=>row.rowId===999).cells[0].value,99);
  assert.equal(rows.at(-1).rowId,'__ghost__');
});

test('full-range client clipboard is independent of mounted window and cell cap',()=>{
  const table=tableFor(22050);
  const rect={start:0,end:22050,columnStart:0,columnEnd:1};
  const text=clientClipboardText(rect,table.data,columns,columns);
  assert.equal(text.split('\n').length,22050);
  assert.ok(text.endsWith(String((22049)*8)));
  assert.equal(clientClipboardText(rect,table.data,columns,columns,100),null);
});
