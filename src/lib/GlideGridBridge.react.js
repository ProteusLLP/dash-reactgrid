import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import DataEditor, {CompactSelection, GridCellKind} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  cellAt, dataRowAt, displayValue, editCell, isDataCell,
  nativeRange, publicLocation,
} from "./glideBridgeModel.js";

const empty = () => ({columns: CompactSelection.empty(), rows: CompactSelection.empty()});
const GRID_ROW_HEIGHT = 27;

/**
 * Opt-in compatibility renderer. This deliberately consumes the *existing*
 * ReactGrid rows/callbacks, so Dash's model, sparse edits, locks, clipboard,
 * validation and undo pathway remain authoritative.
 *
 * It is not yet a native Glide stateless server viewport: the calling
 * ServerVirtualGrid continues to use ReactGrid while this is experimental.
 */
export const GlideGridBridge = ({
  rows, columns, onCellsChanged, onSelectionChanged,
  onFocusLocationChanged, onColumnResized, onContextMenu,
  focusLocation, enableFillHandle, enableRangeSelection,
  enableColumnSelection, enableRowSelection, stickyLeftColumns,
}) => {
  const gridRef = useRef(null);
  const hostRef = useRef(null);
  const [selection,setSelection] = useState(empty);
  const [menu,setMenu] = useState(null);
  const [portal,setPortal] = useState(null);
  useEffect(()=>{
    let element=document.getElementById("portal");
    if(!element){
      element=document.createElement("div");
      element.id="portal";
      Object.assign(element.style,{position:"fixed",left:"0",top:"0",zIndex:"9999"});
      document.body.appendChild(element);
    }
    setPortal(element);
  },[]);

  const glideColumns=useMemo(() => columns.map((column,i)=>({
    id: String(column.columnId),
    title: String(rows[0]?.cells[i]?.text ?? column.columnId),
    width: column.width || 120,
  })),[columns,rows]);

  const cellContent=useCallback(([col,row])=>{
    const cell=cellAt(rows,col,row);
    if (!cell || !isDataCell(rows,columns,col,row))
      return {kind:GridCellKind.Loading,allowOverlay:false};
    const locked=Boolean(cell.nonEditable || cell.isDisabled);
    if (cell.type==="checkbox") return {
      kind:GridCellKind.Boolean, data:Boolean(cell.checked), readonly:locked,
      allowOverlay:false, copyData:cell.checked?"TRUE":"FALSE",
    };
    if (cell.type==="number" || cell.type==="customnumber") return {
      kind:GridCellKind.Number,
      data:Number.isFinite(cell.value)?cell.value:undefined,
      displayData:displayValue(cell),
      readonly:locked, allowOverlay:!locked,
      copyData:Number.isFinite(cell.value)?String(cell.value):"",
    };
    // Percent, dropdown, date and time require text overlays so the original
    // application parser, rather than Glide's numeric coercion, owns values.
    const display=displayValue(cell);
    const copy=cell.type==="percent" && Number.isFinite(cell.value)
      ? String(cell.value)
      : cell.type==="dropdown" ? String(cell.selectedValue??"") : display;
    return {kind:GridCellKind.Text,data:display,displayData:display,
      allowOverlay:!locked,readonly:locked,copyData:copy};
  },[rows,columns]);

  const onEdits=useCallback(changes=>{
    const mapped=[];
    for(const item of changes) {
      const [col,row]=item.location;
      if(!isDataCell(rows,columns,col,row)) continue;
      const previousCell=cellAt(rows,col,row);
      const next=editCell(previousCell,item.value,window.navigator.language);
      if(!next) continue;
      mapped.push({rowId:dataRowAt(rows,row).rowId,
        columnId:columns[col].columnId,previousCell,newCell:next});
    }
    if(mapped.length) onCellsChanged?.(mapped);
    return true;
  },[rows,columns,onCellsChanged]);

  const cellsForSelection=useCallback(rect=>{
    const count=rect.width*rect.height;
    if(count > 20000 || rect.height > 1000) return [];
    return Array.from({length:rect.height},(_,r)=>
      Array.from({length:rect.width},(_,c)=>cellContent([rect.x+c,rect.y+r])));
  },[cellContent]);

  const onSelection=useCallback(next=>{
    setSelection(next);
    setMenu(null);
    const current=next.current;
    if(current) {
      const location=publicLocation(rows,columns,...current.cell);
      if(location) onFocusLocationChanged?.(location);
      if(current.range)
        onSelectionChanged?.(nativeRange(rows,columns,current.range));
    } else onSelectionChanged?.([]);
  },[rows,columns,onSelectionChanged,onFocusLocationChanged]);

  useEffect(()=>{
    if(!focusLocation) return;
    const row=rows.findIndex((r,i)=>i>0 && r.rowId===focusLocation.rowId)-1;
    const col=columns.findIndex(c=>c.columnId===focusLocation.columnId);
    if(row < 0 || col < 0) return;
    setSelection({
      ...empty(),
      current:{cell:[col,row],range:{x:col,y:row,width:1,height:1},rangeStack:[]},
    });
    gridRef.current?.scrollTo?.(col,row);
  },[focusLocation,rows,columns]);

  const onCellContextMenu=useCallback((location,event)=>{
    const [col,row]=location;
    if(!isDataCell(rows,columns,col,row)) return;
    const rowId=rows[row+1].rowId;
    const columnId=columns[col].columnId;
    const entries=onContextMenu?.([rowId],[columnId],"range",[],[[{rowId,columnId}]]);
    if(!entries?.length) return;
    event.preventDefault?.();
    const host=hostRef.current?.getBoundingClientRect();
    setMenu({
      x:Math.max(0,Math.min(400,(event.clientX??host?.left??0)-(host?.left??0))),
      y:Math.max(0,Math.min(400,(event.clientY??host?.top??0)-(host?.top??0))),
      entries,
    });
  },[rows,columns,onContextMenu]);

  const height=Math.max(86,Math.min(480,(rows.length+1)*GRID_ROW_HEIGHT+12));
  if(!portal) return <div className="drg-glide-loading" role="status">Loading canvas editor</div>;
  return <div ref={hostRef} className="drg-glide" data-testid="drg-glide"
      style={{position:"relative",width:"100%",height}}>
    <DataEditor ref={gridRef} portalElementRef={{current:portal}} columns={glideColumns} rows={Math.max(0,rows.length-1)}
      width="100%" height={height} rowHeight={GRID_ROW_HEIGHT} headerHeight={32}
      getCellContent={cellContent} getCellsForSelection={cellsForSelection}
      onCellsEdited={onEdits} onPaste={true}
      gridSelection={selection} onGridSelectionChange={onSelection}
      onCellContextMenu={onCellContextMenu}
      onColumnResize={(column,width)=>onColumnResized?.(column.id,width,[column.id])}
      rangeSelect={enableRangeSelection?"rect":"cell"}
      rowSelect={enableRowSelection?"multi":"none"}
      columnSelect={enableColumnSelection?"multi":"none"}
      freezeColumns={Math.max(0,stickyLeftColumns||0)}
      fillHandle={Boolean(enableFillHandle)} smoothScrollY={false}/>
    {menu && <div className="drg-glide-menu" role="menu" style={{
      position:"absolute",left:menu.x,top:menu.y,zIndex:12,
      background:"white",border:"1px solid #ccd",boxShadow:"0 3px 12px #0002",
    }}>{menu.entries.map((item,i)=><button key={String(item.id??i)}
      role="menuitem" type="button"
      onClick={() => {setMenu(null);item.handler?.();}}>
      {item.label}
    </button>)}</div>}
  </div>;
};
