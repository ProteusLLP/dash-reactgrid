/* Client-side viewport: full data stays in browser memory. ReactGrid only sees
 * a bounded row window plus synthetic geometry spacers. No Dash fetches.
 */
import { buildGridRows } from "./gridRows.js";
import { buildVirtualRows } from "./serverVirtual.js";
import { escapeTsvCell } from "./virtualOperations.js";

export const buildClientVirtualRows = ({
  table, range, rowHeight, viewportHeight, columns, descriptors, allColumns,
  newRow, readOnly, locked, styleHeader, showGhost, openDropdown,
}) => {
  const page = {
    data: table.data.slice(range.start, range.end),
    rowIds: table.rowIds.slice(range.start, range.end),
  };
  const rows = buildVirtualRows({
    page, columns, descriptors, allColumns, rowCount:table.data.length, range,
    rowHeight, viewportHeight, readOnly, locked, styleHeader, openDropdown,
  });
  if (showGhost && range.end === table.data.length) {
    const ghost = buildGridRows({
      columns, descriptors, allColumns, data:[], rowIds:[],
      newRow, readOnly, locked, styleHeader, showGhost:true, openDropdown,
    }).rows.at(-1);
    rows.push({...ghost,height:rowHeight});
  }
  return rows;
};

// A browser clipboard is constrained by bytes rather than an arbitrary cell
// count. Copy directly from the store; do not materialize offscreen grid cells.
export const clientClipboardText = (rect, data, allColumns, columns,
  maxChars = 64 * 1024 * 1024) => {
  if (!rect) return "";
  const indexes = new Map(allColumns.map((column,i)=>[column.columnId,i]));
  const visible=columns.slice(rect.columnStart,rect.columnEnd);
  const indices=visible.map(column => indexes.get(column.columnId));
  if (indices.some(index => index === undefined)) return null;
  const lines = [];
  let chars=0;
  for (let row=rect.start; row<rect.end; row++) {
    const source=data[row];
    if (!source) return null;
    const line=indices.map((index,i) => {
      const value=source[index];
      if (value==null || (typeof value==="number" && !Number.isFinite(value))) return "";
      if (visible[i].type==="checkbox") return value ? "TRUE" : "FALSE";
      return escapeTsvCell(String(value));
    }).join("\t");
    chars+=line.length+1;
    if (chars>maxChars) return null;
    lines.push(line);
  }
  return lines.join("\n");
};
