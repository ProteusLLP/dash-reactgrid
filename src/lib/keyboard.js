/*
 * Keyboard selection and clipboard helpers, independent of React rendering.
 * ReactGrid v4.1.x does not call onSelectionChanged for Ctrl/Cmd+A.
 */
import { escapeTsvCell } from "./virtualOperations.js";

const range = (rows, columns, firstRow, lastRow, firstCol, lastCol) => {
  if (firstRow < 0 || lastRow >= rows.length || firstCol < 0 || lastCol >= columns.length) return null;
  const selectedRows = rows.slice(firstRow, lastRow + 1)
    .map((row, offset) => ({ rowId: row.rowId, idx: firstRow + offset }));
  const selectedColumns = columns.slice(firstCol, lastCol + 1)
    .map((column, offset) => ({ columnId: column.columnId, idx: firstCol + offset }));
  if (!selectedRows.length || !selectedColumns.length) return null;
  return {
    first: { row: selectedRows[0], column: selectedColumns[0] },
    last: { row: selectedRows[selectedRows.length - 1], column: selectedColumns[selectedColumns.length - 1] },
    rows: selectedRows,
    columns: selectedColumns,
  };
};

/** The same selection extent as ReactGrid's built-in Ctrl/Cmd+A. */
export const wholeGridRange = (rows, columns) =>
  range(rows, columns, 0, rows.length - 1, 0, columns.length - 1);

export const focusedRange = (rows, columns, location) => {
  if (!location) return null;
  const ri = rows.findIndex((row) => row.rowId === location.rowId);
  const ci = columns.findIndex((column) => column.columnId === location.columnId);
  return range(rows, columns, ri, ri, ci, ci);
};

export const isWholeGridSelected = (ranges, rows, columns) => {
  const selected = ranges?.length === 1 && ranges[0];
  return Boolean(selected &&
    selected.first.row.idx === 0 &&
    selected.first.column.idx === 0 &&
    selected.last.row.idx === rows.length - 1 &&
    selected.last.column.idx === columns.length - 1);
};

/** Mirror the grid's Ctrl/Cmd+A toggle, even though its callback does not fire. */
export const selectAllRanges = (ranges, rows, columns, location) => {
  if (isWholeGridSelected(ranges, rows, columns)) {
    const focused = focusedRange(rows, columns, location);
    return focused ? [focused] : ranges;
  }
  const full = wholeGridRange(rows, columns);
  return full ? [full] : ranges;
};

/** Native cell-editor inputs must keep their own Ctrl/Cmd+A behaviour. */
export const isCellEditorTarget = (target) => {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest('textarea, [contenteditable="true"], input:not(.rg-hidden-element)'));
};

/** Copy tab-separated values. The extendable table's blank ghost is not data. */
export const selectionText = (rows, ranges, textOf) => {
  if (!ranges?.length) return null;
  const { first, last } = ranges[0];
  if (!first || !last) return null;
  const lines = [];
  for (let ri = first.row.idx; ri <= last.row.idx; ri++) {
    const row = rows[ri];
    if (!row || row.rowId === "__ghost__" ||
        row.rowId === "__drg_virtual_spacer_top__" ||
        row.rowId === "__drg_virtual_spacer_bottom__" ||
        String(row.rowId).startsWith("__drg_virtual_loading_")) continue;
    const cells = [];
    for (let ci = first.column.idx; ci <= last.column.idx; ci++) {
      cells.push(row.cells[ci] ? textOf(row.cells[ci]) : "");
    }
    lines.push(cells.map(escapeTsvCell).join("\t"));
  }
  return lines.join("\n");
};

/** The header is not an editable data row. */
export const pasteStartRow = (selection) =>
  Math.max(0, selection.first.row.idx - 1);

/**
 * Turn Delete/Backspace on a grid selection into changes for editable data cells.
 * Keep the final real row editable and ignore the header and extension row.
 */
export const clearSelectedCells = (rows, columns, ranges) => {
  const changes = [];
  const seen = new Set();
  (ranges || []).forEach((selected) => {
    for (let ri = selected.first.row.idx; ri <= selected.last.row.idx; ri++) {
      const row = rows[ri];
      if (!row || row.rowId === "header" || row.rowId === "__ghost__") continue;
      for (let ci = selected.first.column.idx; ci <= selected.last.column.idx; ci++) {
        const column = columns[ci];
        const cell = row.cells[ci];
        if (!column || !cell || cell.nonEditable) continue;
        const key = ri + ":" + ci;
        if (seen.has(key)) continue;
        seen.add(key);
        const value = cell.type === "checkbox" ? false :
          cell.type === "text" ? "" : null;
        changes.push({ rowId: row.rowId, columnId: column.columnId, value });
      }
    }
  });
  return changes;
};
