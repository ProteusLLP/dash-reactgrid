import React, { useEffect, useState, useMemo, useCallback } from 'react';
import PropTypes, { checkPropTypes } from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';


const locale = window.navigator.language;

const parseToValue = (text, type) => {
  switch (type) {
    case "number":
    case "customnumber":
      return numberParser.parse(text);
    case "percent":
      return percentParser.parse(text);
    default:
      return text;
  }
};


const getCellValueAsString = (cell) => {
  if (cell.type === "text") return cell.text;
  if (cell.value !== undefined) {
    return cell.value.toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 17 });
  }
  return "";
};

const changeCellDataToType = (new_type, cell) => {
  switch (new_type) {
    case 'text':
      return getCellValueAsString(cell)
    case 'number':
    case 'customnumber':
    case 'percent':
      if (cell.type === 'text') {
        return parseToValue(cell.text, new_type)
      }
      return cell.value || parseToValue(cell.text, new_type)
    default:
      return cell.value || cell.text; // Fallback to text representation
  }
}

/**
 * DashReactGrid is a wrapper around the ReactGrid component that allows for easy integration with Dash applications. 
 */
const DashReactGrid = ({
  id,
  columns,
  data,
  enableFillHandle,
  enableRangeSelection,
  enableRowSelection,
  enableColumnSelection,
  highlights,
  stickyLeftColumns,
  stickyRightColumns,
  stickyTopRows,
  stickyBottomRows,
  isExtendable,
  selectedCell,
  selectedRange,
  style,
  styleHeader,
  className,
  disableVirtualScrolling,
  setProps,
  persistence,
  persistence_type,
  persisted_props
}) => {
  const [gridData, setGridData] = useState(data);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    setGridData(data);
  }, [data]);

  const customCellTemplates = useMemo(() => ({
    percent: new PercentCellTemplate(),
    customnumber: new CustomNumberCellTemplate(),
    number: new CustomNumberCellTemplate()
  }), []);

  const rows = useMemo(() => (
    [
      { rowId: "header", cells: columns.map(col => ({ type: "header", text: col.title, style: col.headerStyle || styleHeader || {} })) },
      ...gridData.map((row, idx) => ({
        rowId: idx,
        cells: columns.map((col, colIdx) => {
          const cellValue = row[colIdx] || null;
          return {
            type: col.type || 'text',
            value: cellValue,
            text: col.type === 'text' ? String(cellValue) : undefined,
            style: col.style || {},
            nonEditable: col.nonEditable || false,
            format: col.formatOptions ? new Intl.NumberFormat(locale, col.formatOptions) : undefined
          };
        })
      }))
    ]
  ), [columns, gridData]);

  const applyChanges = useCallback((changes) => {
    if (!changes.length) return;
    setGridData(prevData => {
      const newData = [...prevData];
      const maxRowId = prevData.length;

      changes.forEach(({ rowId, columnId, newCell }) => {
        const colIdx = columns.findIndex(col => col.columnId === columnId);
        if (colIdx !== -1) {
          if (rowId >= newData.length && isExtendable) {
            // Add new rows if the pasted data exceeds current rows
            while (newData.length <= rowId) {
              newData.push(new Array(columns.length).fill(""));
            }
          }
          newData[rowId] = [...newData[rowId]];
          newData[rowId][colIdx] = newCell.value || newCell.text
        }
      });

      setProps({ data: newData });
      return newData;
    });
    setHistory(prev => [...prev.slice(0, historyIndex + 1), changes]);
    setHistoryIndex(prev => prev + 1);
  }, [columns, setProps, historyIndex, isExtendable]);

  const selectedRangeToTable = (selectedRange) => {
    const table = []
    for (let row = selectedRange.first.row.idx; row <= selectedRange.last.row.idx; row++) {
      const tableRow = []
      for (let column = selectedRange.first.column.idx; column <= selectedRange.last.column.idx; column++) {
        const cellValue = row === 0 ? columns[column].title : gridData[row - 1][column];
        tableRow.push(getCellValueAsString({ type: columns[column].type || "text", value: cellValue, text: cellValue }))
      }
      table.push(tableRow.join("\t"))
    }
    return table.join("\n")
  }

  const handleCopy = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const activeSelectedRange = selectedRange[0];
    if (!activeSelectedRange) {
      return
    }
    const table = selectedRangeToTable(activeSelectedRange);
    e.clipboardData.setData("text/plain", table);
  };

const handlePaste = (e) => {
  e.stopPropagation();
  e.preventDefault();

  const activeRange = selectedRange[0];
  if (!activeRange) return;                       // nothing selected

  /* -------- 1. Parse clipboard into `pastedRows` -------- */
  const htmlData = e.clipboardData.getData("text/html");
  const doc      = new DOMParser().parseFromString(htmlData, "text/html");
  const isRGHtml = doc.body.firstElementChild?.getAttribute("data-reactgrid") === "reactgrid-content";

  let pastedRows = [];

  // (a) Pasting from another ReactGrid
  if (isRGHtml && doc.body.firstElementChild?.firstElementChild) {
    const tableRows = doc.body.firstElementChild.firstElementChild.children;

    for (let ri = 0; ri < tableRows.length; ri++) {
      const row = [];
      for (let ci = 0; ci < tableRows[ri].children.length; ci++) {
        const raw = tableRows[ri].children[ci].getAttribute("data-reactgrid");
        const cellData = raw && JSON.parse(raw);
        const text     = tableRows[ri].children[ci].innerHTML;
        row.push(cellData ? cellData : { type: "text", text });
      }
      pastedRows.push(row);
    }
  }
  // (b) Plain-text paste (Excel, Numbers, Google Sheets, etc.)
  else {
    pastedRows = e.clipboardData
      .getData("text/plain")
      .replace(/(\r\n)$/, "")                       // Excel adds a blank line
      .split("\n")
      .map(line =>
        line
          .split("\t")
          .map(t => ({ type: "text", text: t.replace("\r", "") }))
      );
  }

  if (!pastedRows.length) return;

  /* -------- 2. Build a Change[] batch for applyChanges -------- */
  const changes = [];

  pastedRows.forEach((row, ri) => {
    const rowId = activeRange.first.row.idx + ri - 1;       // −1 removes header

    row.forEach((cell, ci) => {
      const colIdx = activeRange.first.column.idx + ci;
      if (colIdx >= columns.length) return;                 // outside table

      const column   = columns[colIdx];
      const colType  = column.type || "text";

      // --- previous value on the grid (may be undefined / overflow row) ---
      const prevVal  = gridData[rowId]?.[colIdx];
      const oldCell  = colType === "text"
        ? { text: prevVal ?? "" }
        : { value: prevVal ?? null };

      // --- value coming from clipboard, coerced to column type -------------
      const coerced  =
        changeCellDataToType(colType, cell) ??
        parseToValue(cell.text, colType);

      const newCell  = colType === "text"
        ? { text: coerced ?? "" }
        : { value: coerced };

      changes.push({
        rowId,
        columnId: column.columnId,
        oldCell,
        newCell
      });
    });
  });

  /* -------- 3. Let the existing infrastructure apply & log it -------- */
  applyChanges(changes);
};
  /** Convert a ReactGrid Cell object back to the plain value
 *  that belongs in `gridData`, respecting the column’s type. */
const asGridValue = (cell, columnType) => {
  if (!cell) return null;                          // blank / deleted
  if (cell.value) return cell.value;
  return changeCellDataToType(columnType || "text", cell);
};

const handleUndoChanges = useCallback(() => {
  setHistoryIndex(idx => {
    if (idx < 0) return idx;                       // nothing to undo
    const batch = history[idx];
    
    setGridData(data => {
      const next = [...data];

      batch.forEach(({ rowId, columnId, previousCell }) => {
        const colIdx = columns.findIndex(c => c.columnId === columnId);
        if (colIdx === -1 || rowId >= next.length) return;

        next[rowId] = [...next[rowId]];
        next[rowId][colIdx] = asGridValue(previousCell, columns[colIdx].type);
      });

      setProps({ data: next });
      return next;
    });

    return idx - 1;                               // move pointer back
  });
}, [history, columns, setProps]);

/* ------------------------------ REDO ------------------------------ */
const handleRedoChanges = useCallback(() => {
  setHistoryIndex(idx => {
    if (idx + 1 >= history.length) return idx;     // nothing to redo
    const nextIdx = idx + 1;
    const batch   = history[nextIdx];

    setGridData(data => {
      const next = [...data];

      batch.forEach(({ rowId, columnId, newCell }) => {
        const colIdx = columns.findIndex(c => c.columnId === columnId);
        if (colIdx === -1 || rowId >= next.length) return;

        next[rowId] = [...next[rowId]];
        next[rowId][colIdx] = asGridValue(newCell, columns[colIdx].type);
      });

      setProps({ data: next });
      return next;
    });

    return nextIdx;                               // advance pointer
  });
}, [history, columns, setProps]);

  return (
    <div id={id} style={style} className={className} tabIndex={0}
      onPasteCapture={handlePaste} onCopyCapture={handleCopy} onKeyDownCapture={e => {
    if ((e.metaKey||e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      handleUndoChanges();
    } else if ((e.metaKey||e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      handleRedoChanges();
    }
  }}>
      <ReactGrid
        rows={rows}
        columns={columns}
        onCellsChanged={applyChanges}
        enableFillHandle={enableFillHandle}
        enableRangeSelection={enableRangeSelection}
        enableRowSelection={enableRowSelection}
        enableColumnSelection={enableColumnSelection}
        highlights={highlights}
        stickyLeftColumns={stickyLeftColumns}
        stickyRightColumns={stickyRightColumns}
        stickyTopRows={stickyTopRows}
        stickyBottomRows={stickyBottomRows}
        disableVirtualScrolling={disableVirtualScrolling}
        onSelectionChanged={selectedRange => setProps({ selectedRange: selectedRange })}
        onSelectionChanging={selectedRange => {
          setProps({ selectedRange: selectedRange });
          return true
        }
        }
        onFocusLocationChanged={selectedCell => setProps({ selectedCell })}
        customCellTemplates={customCellTemplates}
      />
    </div>
  );
};


DashReactGrid.defaultProps = {
  enableFillHandle: true,
  enableRangeSelection: true,
  enableRowSelection: false,
  enableColumnSelection: false,
  stickyLeftColumns: 0,
  stickyRightColumns: 0,
  stickyTopRows: 0,
  stickyBottomRows: 0,
  highlights: null,
  isExtendable: false,
  className: null,
  disableVirtualScrolling: false,
  persistence_type: 'local',
  persisted_props: ['columns', 'data'],
}

DashReactGrid.propTypes = {
  /**
  *The ID used to identify this component in Dash callbacks
  */
  id: PropTypes.string,
  // Array of column definitions containing column metadata
  columns: PropTypes.array.isRequired,
  // 2D array representing the grid data 
  data: PropTypes.array.isRequired,
  // Enables fill handle for quick copy-pasting of cell values
  enableFillHandle: PropTypes.bool,
  // Allows selection of a range of cells
  enableRangeSelection: PropTypes.bool,
  // Enables row selection 
  enableRowSelection: PropTypes.bool,
  // Enables column selection
  enableColumnSelection: PropTypes.bool,
  // Array of highlighted cell ranges
  highlights: PropTypes.array,
  // Number of columns that should remain fixed on the left when scrolling
  stickyLeftColumns: PropTypes.number,
  // Number of columns that should remain fixed on the right when scrolling
  stickyRightColumns: PropTypes.number,
  // Number of rows that should remain fixed on top when scrolling 
  stickyTopRows: PropTypes.number,
  // Number of rows that should remain fixed at the bottom when scrolling
  stickyBottomRows: PropTypes.number,
  // Whether new rows can be added dynamically
  isExtendable: PropTypes.bool,
  // Object representing the currently selected cell
  selectedCell: PropTypes.object,
  // Object representing the currently selected range of cells
  selectedRange: PropTypes.array,
  // Custom styles applied to the component wrapper
  style: PropTypes.object,
  // Custom styles applied to the header row
  styleHeader: PropTypes.object,
  // CSS class applied to the component wrapper 
  className: PropTypes.string,
  // Disables virtual scrolling for large datasets
  disableVirtualScrolling: PropTypes.bool,
  // Dash callback function to update component props
  setProps: PropTypes.func,
  // Whether the component's state should persist across sessions
  persistence: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
  // The storage type used for persistence 
  persistence_type: PropTypes.oneOf(["local", "session", "memory"]),
  // List of properties that should persist across sessions
  persisted_props: PropTypes.array
};

export default DashReactGrid;
