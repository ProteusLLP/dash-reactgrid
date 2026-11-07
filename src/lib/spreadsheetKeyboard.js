/* Excel-style keyboard navigation and range editing.
 * The keyboard range is compact and uses zero-based ABSOLUTE data rows.
 * No dense array of selected cells is ever allocated merely to navigate.
 */
import { escapeTsvCell } from "./virtualOperations.js";
import { pastedValue, valueOf } from "./model.js";

export const MAX_KEYBOARD_EDIT_CELLS = 20000;

/** Arrow keys jump to the first/last data row or visible column. */
export const sheetEdge = (key, current, rowCount, columnCount) => {
  if (!current || rowCount < 1 || columnCount < 1) return null;
  const next = { row:current.row, col:current.col };
  switch (key) {
    case "ArrowUp": next.row=0; break;
    case "ArrowDown": next.row=rowCount-1; break;
    case "ArrowLeft": next.col=0; break;
    case "ArrowRight": next.col=columnCount-1; break;
    default: return null;
  }
  return next;
};

export const keyboardRectangle = (anchor, cursor) => ({
  start:Math.min(anchor.row,cursor.row),
  end:Math.max(anchor.row,cursor.row)+1,
  columnStart:Math.min(anchor.col,cursor.col),
  columnEnd:Math.max(anchor.col,cursor.col)+1,
});

export const keyboardArea = (selection) =>
  selection ? (selection.end-selection.start) *
    (selection.columnEnd-selection.columnStart) : 0;

/** Convert ReactGrid's header-inclusive, page-local selection to data indices. */
export const nativeRectangle = (ranges, pageStart, rowCount, columnCount, fallback = null) => {
  const selected=ranges?.[0];
  if (!selected?.first || !selected?.last) {
    if (!fallback) return null;
    return keyboardRectangle(fallback,fallback);
  }
  const firstRow=Math.min(selected.first.row.idx,selected.last.row.idx);
  const lastRow=Math.max(selected.first.row.idx,selected.last.row.idx);
  const c0=Math.min(selected.first.column.idx,selected.last.column.idx);
  const c1=Math.max(selected.first.column.idx,selected.last.column.idx);
  const start=Math.max(0,pageStart+firstRow-1);
  const end=Math.min(rowCount,pageStart+lastRow);
  if (end <= start || c0 < 0 || c1 >= columnCount) return null;
  return {start,end,columnStart:c0,columnEnd:c1+1};
};

/** Compact public range descriptor compatible with first/last Range consumers.
 * Avoid enumerating every row when a keyboard selection spans 100k rows.
 */
export const publicKeyboardRange = (rect, rowIds, columns) => {
  const first={row:{idx:rect.start+1,rowId:rowIds[rect.start]},
    column:{idx:rect.columnStart,columnId:columns[rect.columnStart].columnId}};
  const last={row:{idx:rect.end,rowId:rowIds[rect.end-1]},
    column:{idx:rect.columnEnd-1,columnId:columns[rect.columnEnd-1].columnId}};
  const n=rect.end-rect.start;
  return {first,last,
    rows:n<=1000 ? Array.from({length:n},(_,i)=>({
      idx:rect.start+1+i,rowId:rowIds[rect.start+i],
    })) : [],
    columns:columns.slice(rect.columnStart,rect.columnEnd).map((column,i)=>({
      idx:rect.columnStart+i,columnId:column.columnId,
    }))};
};

export const keyboardHighlights = (rect, rowIds, columns, pageStart, pageEnd, limit = 5000) => {
  if (!rect) return [];
  const from=Math.max(rect.start,pageStart),to=Math.min(rect.end,pageEnd);
  const count=(to-from)*(rect.columnEnd-rect.columnStart);
  if (!count || count>limit) return [];
  const highlighted=[];
  for(let i=from;i<to;i++)
    for(let c=rect.columnStart;c<rect.columnEnd;c++)
      highlighted.push({rowId:rowIds[i],columnId:columns[c].columnId,
        className:"rg-keyboard-selected"});
  return highlighted;
};

/** Build only changed destinations. The source row is the top of a selected
 * range; with a single focused cell Excel fills that cell from the row above.
 */
export const fillDownChanges = (rect, data, rowIds, allColumns, columns, canEdit) => {
  if (!rect) return [];
  const source=rect.end-rect.start>1 ? rect.start : rect.start-1;
  if (source<0 || source>=data.length) return [];
  const start=source===rect.start ? rect.start+1 : rect.start;
  const count=(rect.end-start)*(rect.columnEnd-rect.columnStart);
  if (count>MAX_KEYBOARD_EDIT_CELLS)
    throw new RangeError("Fill down is limited to 20,000 cells per operation");
  const indexes=new Map(allColumns.map((col,i)=>[col.columnId,i]));
  const edits=[];
  for(let row=start;row<rect.end;row++){
    if (row>=data.length) break;
    const rowId=rowIds[row];
    for(let c=rect.columnStart;c<rect.columnEnd;c++){
      const col=columns[c];
      if (!col || !canEdit(rowId,col,data[row])) continue;
      const value=data[source][indexes.get(col.columnId)];
      edits.push({rowId,columnId:col.columnId,value});
    }
  }
  return edits;
};

/** Shift+Enter commits the active editor's new value to each editable cell
 * of the selected range, converting the value to the target column type.
 */
export const multiEditChanges = (rect, changed, sourceColumn, rowAt, columns, canEdit, parsers) => {
  if (keyboardArea(rect)<=1) return null;
  if (keyboardArea(rect)>MAX_KEYBOARD_EDIT_CELLS)
    throw new RangeError("Multi-cell editing is limited to 20,000 cells per operation");
  const raw=valueOf(sourceColumn,changed.newCell);
  const edits=[];
  for(let row=rect.start;row<rect.end;row++){
    const target=rowAt(row);
    if (!target) continue;
    for(let c=rect.columnStart;c<rect.columnEnd;c++){
      const col=columns[c];
      if (!col || !canEdit(target.rowId,col,target.values)) continue;
      const value=col.type===sourceColumn.type
        ? raw : pastedValue(col,{type:"text",text:raw == null ? "" : String(raw)},parsers);
      edits.push({rowId:target.rowId,columnId:col.columnId,value});
    }
  }
  return edits;
};

/** Text for a compact selection, preserving the same TSV/Excel escaping. */
export const keyboardClipboardText = (rect,data,allColumns,columns,maxCells=MAX_KEYBOARD_EDIT_CELLS) => {
  if (keyboardArea(rect)>maxCells) return null;
  const indexes=new Map(allColumns.map((col,i)=>[col.columnId,i]));
  const lines=[];
  for(let row=rect.start;row<rect.end;row++){
    const values=columns.slice(rect.columnStart,rect.columnEnd).map(col=>{
      const v=data[row]?.[indexes.get(col.columnId)];
      if (v==null || (typeof v==="number" && !Number.isFinite(v))) return "";
      if (col.type==="checkbox") return v ? "TRUE":"FALSE";
      return String(v);
    });
    lines.push(values.map(escapeTsvCell).join("\t"));
  }
  return lines.join("\n");
};
