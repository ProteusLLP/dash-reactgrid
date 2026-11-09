/* Global, server-indexed selection and clipboard operations for virtual rows. */
export const MAX_RANGE_ROWS = 1000;
export const MAX_PASTE_CELLS = 20000;

export const boundedSelection = (start, end, colStart, colEnd, totalRows, columnCount) => {
  if (!Number.isSafeInteger(totalRows) || totalRows < 0 ||
      !Number.isSafeInteger(columnCount) || columnCount < 1) return null;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(colStart) || !Number.isSafeInteger(colEnd)) return null;
  if (start < 0 || end <= start || end > totalRows ||
      colStart < 0 || colEnd <= colStart || colEnd > columnCount) return null;
  return { start, end, columnStart: colStart, columnEnd: colEnd };
};

export const extendSelection = (anchor, row, col, totalRows, columns) =>
  boundedSelection(
    Math.min(anchor.row, row), Math.max(anchor.row, row) + 1,
    Math.min(anchor.col, col), Math.max(anchor.col, col) + 1,
    totalRows, columns,
  );

/** Preserve tabs, newlines and quotes when the grid's TSV is pasted back. */
export const escapeTsvCell = (value) => {
  const text = String(value ?? "");
  return /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

/** For date/time and other raw-value cells, copy the authoritative
 * value from the locally overlaid page. Match columns by ID because hidden
 * columns are still present in page.data but absent from the visible grid.
 */
export const virtualRawCellCopyText = (page, rowOffset, columnId, allColumns) => {
  const index=allColumns.findIndex(col=>col.columnId===columnId);
  const row=page?.data?.[rowOffset];
  if (index<0 || !Array.isArray(row) || index>=row.length) return null;
  return escapeTsvCell(row[index] == null ? "" : row[index]);
};

/** RFC4180-style TSV including quoted tabs, newlines and escaped double quotes. */
export const parseClipboardTsv = (text) => {
  const output=[];
  let row=[];
  let field="";
  let quoted=false;
  const source=String(text ?? "").replace(/\r\n/g,"\n");
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(quoted){
      if(char==='"' && source[i+1]==='"'){field+='"';i++;}
      else if(char==='"')quoted=false;
      else field+=char;
    }else if(char==='"' && field===""){
      quoted=true;
    }else if(char==="\t"){
      row.push(field);field="";
    }else if(char==="\n"){
      row.push(field);output.push(row);
      row=[];field="";
    }else field+=char;
  }
  if(quoted)throw new Error("The pasted table has an unterminated quote");
  if(field!=="" || row.length>0 || !source.endsWith("\n")){
    row.push(field);output.push(row);
  }
  return output;
};

export const makeRangePaste = (text, selection, columns, totalRows, convert) => {
  if(!selection)throw new Error("Select a starting row and column before pasting");
  const parsed=parseClipboardTsv(text);
  if(!parsed.length || !parsed[0]?.length)throw new Error("Nothing to paste");
  const width=parsed[0].length;
  if(parsed.some(row=>row.length!==width))
    throw new Error("Pasted rows have inconsistent column counts");
  if(parsed.length>MAX_RANGE_ROWS || width*parsed.length>MAX_PASTE_CELLS)
    throw new Error("Paste is larger than the permitted batch; split it into smaller ranges");
  if(selection.start+parsed.length>totalRows)
    throw new Error("Paste extends beyond the final row; insert more rows first");
  if(selection.columnStart+width>columns.length)
    throw new Error("Paste extends beyond the final visible column");
  const target=columns.slice(selection.columnStart,selection.columnStart+width);
  if (target.some((column) => column.nonEditable))
    throw new Error("Cannot paste into a non-editable column");
  return {kind:"paste",start:selection.start,columnIds:target.map(x=>x.columnId),
    rows:parsed.map(row=>row.map((value,i)=>convert(target[i],value)))};
};

/** Keep non-editable columns out of virtual fill commands. Values remain
 * aligned with the selected column IDs, even when a middle column is skipped.
 * Per-row locked and conditional cells are checked by the authoritative host.
 */
export const editableFillColumns = (selectedColumns, values = null) => {
  if (values !== null && (!Array.isArray(values) ||
      values.length !== selectedColumns.length))
    throw new RangeError("Fill values must match selected columns");
  const columnIds=[];
  const filtered=[];
  selectedColumns.forEach((column,index) => {
    if (column.nonEditable) return;
    columnIds.push(column.columnId);
    if (values !== null) filtered.push(values[index]);
  });
  return values === null ? {columnIds} : {columnIds, values:filtered};
};

export const selectedColumnIds = (selection, visibleColumns) =>
  visibleColumns.slice(selection.columnStart, selection.columnEnd)
    .map((column) => column.columnId);

export const copyRequestFor = (datasetId, requestId, selection, visibleColumns) => ({
  datasetId, requestId, ...selection,
  ...(visibleColumns ? { columnIds: selectedColumnIds(selection, visibleColumns) } : {}),
});

export const matchesCopyResponse = (response, request) =>
  Boolean(response && request &&
    response.datasetId===request.datasetId &&
    response.requestId===request.requestId &&
    response.start===request.start && response.end===request.end &&
    response.columnStart===request.columnStart &&
    response.columnEnd===request.columnEnd &&
    (!request.columnIds || (Array.isArray(response.columnIds) &&
      response.columnIds.length === request.columnIds.length &&
      response.columnIds.every((id, index) => id === request.columnIds[index]))) &&
    (typeof response.text==="string" || typeof response.error==="string"));

/** Undo journal survives reload within the browser's sessionStorage lifetime. */
export const historyStorageKey = (id, datasetId) =>
  "dash-reactgrid:history:v1:" + JSON.stringify([id,datasetId]);

export const initialHistory = (streamId) => ({streamId,undo:[],redo:[]});
export const loadHistory = (storage,key,streamId) => {
  const text=storage.getItem(key);
  if(text===null)return initialHistory(streamId);
  const parsed=JSON.parse(text);
  if(parsed.streamId!==streamId)return initialHistory(streamId);
  if(!Array.isArray(parsed.undo) || !Array.isArray(parsed.redo) ||
      parsed.undo.concat(parsed.redo).some(x=>!Number.isSafeInteger(x) || x<1))
    throw new Error("Corrupt undo history");
  return parsed;
};
export const saveHistory = (storage,key,history) => {
  const limited={...history,undo:history.undo.slice(-200),redo:history.redo.slice(-200)};
  storage.setItem(key,JSON.stringify(limited));
  return limited;
};

export const nextHistory = (history,action,seq) => {
  if(action==="edit")return {...history,undo:[...history.undo,seq],redo:[]};
  if(action==="undo"){
    if(!history.undo.length)return history;
    return {...history,undo:history.undo.slice(0,-1),redo:[...history.redo,seq]};
  }
  if(action==="redo"){
    if(!history.redo.length)return history;
    return {...history,undo:[...history.undo,seq],redo:history.redo.slice(0,-1)};
  }
  return history;
};
