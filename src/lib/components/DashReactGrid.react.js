import React, { useEffect, useState, useMemo, useCallback } from 'react';
import PropTypes, { checkPropTypes } from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import { DateTime } from "luxon";


const locale = window.navigator.language|| 'en-US'; // Default to 'en-US' if locale is not set

function shortPattern(locale) {
  // 31 Dec 1999 is safe (no leading zero), use it as a probe
  const probe = new Date(1999, 11, 31);             // 31-12-1999
  const parts = new Intl.DateTimeFormat(
    locale,
    { dateStyle: "short" }
  ).formatToParts(probe);

  return parts
    .map(p => {
      switch (p.type) {
        case "day":   return p.value.length === 2 ? "dd" : "d";
        case "month": return p.value.length === 2 ? "MM" : "M";
        case "year":  return p.value.length === 4 ? "yyyy" : "yy";
        case "literal": return p.value;                     // keep the slash/dot
        default: return "";
      }
    })
    .join("");
}

function parseLocaleDate(text, locale = locale) {
  // 1️⃣ candidate patterns in *this* locale
  const pattern = shortPattern(locale);          // e.g. "dd/MM/yyyy"
  const dt = DateTime.fromFormat(text, pattern, { locale });
  if (dt.isValid) return dt
  // try UTC
  const utc = DateTime.fromFormat(text, "yyyy-MM-dd'T'HH:mm:ss.SSSZZ", { locale });
  if (utc.isValid) return utc;
  // 3️⃣ last-ditch: ISO / browser parse
  const iso = DateTime.fromISO(text,{locale});
  return iso.isValid ? iso : null;
}

const createCellByType = (column, value, columnStyle, columnNonEditable) => {

  switch (column.type) {
    case 'text':
      return { type: column.type, text: String(value || ''), style: columnStyle, nonEditable: columnNonEditable }
    case 'number':
      return { type: 'customnumber', value: value, style: columnStyle, nonEditable: columnNonEditable, format: new Intl.NumberFormat(locale, { ...column.formatOptions }) }
    case 'percent':
      return { type: 'percent', value: value, style: columnStyle, nonEditable: columnNonEditable, format: new Intl.NumberFormat(locale, { ...column.formatOptions, style: "percent" }) }
    case 'date':{
      const d = new Date(value)
      return { type: column.type, date: value ? d : null, style: columnStyle, nonEditable: columnNonEditable, format: new Intl.DateTimeFormat(locale, { ...column.formatOptions }) }
    }
  }
}

const getCellDataByType = (type, cell) => {
  switch (type) {
    case 'text':
      return cell.text
    case 'number':
    case 'customnumber':
    case 'percent':
      return cell.value
    case 'date':
      return cell.date
  }
}

const parseToValue = (text, type) => {
  switch (type) {
    case "number":
    case "customnumber":
      return numberParser.parse(text);
    case "percent":
      return percentParser.parse(text);
    case "date":{
      const d = new Date(parseLocaleDate(text,locale))
      return d ;
    }
    default:
      return text;
  }
};

const getValueAsString = (type,value)=>{
  switch (type) {
    case "number":
    case "customnumber":
    case "percent":
      return value.toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 17 })
    case "date":{
      const d = new Date(value)
      const str = d.toISOString()
      return str
    }
    default:
      return String(value)
  }
}


const alignToStyle = (align) => {
  switch (align) {
    case "left": return { "justifyContent": "flex-start" };
    case "center": return { "justifyContent": "center" };
    case "right": return { "justifyContent": "flex-end" };
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
      { rowId: "header", cells: columns.map(col => ({ type: "header", text: col.title, style: { ...styleHeader, ...col.headerStyle, ...(col.align ? alignToStyle(col.align) : null) } || null })),height:styleHeader?.height},
      ...gridData.map((row, idx) => ({
        rowId: idx,
        cells: columns.map((col, colIdx) => {
          return createCellByType(col, row[colIdx], { ...col.style, ...(col.align ? alignToStyle(col.align) : null) }, col.nonEditable);
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
          if (rowId >= maxRowId && isExtendable) {
            // Add new rows if the pasted data exceeds current rows
            while (newData.length <= rowId) {
              newData.push(new Array(columns.length).fill(null));
            }
          }
          newData[rowId] = [...newData[rowId]];
          newData[rowId][colIdx] = getCellDataByType(columns[colIdx].type,newCell)
        }
      })
      if (isExtendable) {
      // check to see if rows can be removed
      while (newData.length > 1 && !newData[newData.length - 1].some((v) => v)) {
        newData.pop()
      }
      // check to see if a new row is needed
      
      if (newData[newData.length - 1].some((v) => v)) {
        newData.push(columns.map((_) => null))
      }
    } 
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
        tableRow.push(getValueAsString( columns[column].type || "text", cellValue ))
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
      const oldCell  = createCellByType(column,prevVal)
        

      // --- value coming from clipboard, coerced to column type -------------
      const coerced  = parseToValue(cell.text, colType);

      const newCell  = createCellByType(column,coerced)

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
        next[rowId][colIdx] = getCellDataByType(columns[colIdx].type, previousCell);
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
        next[rowId][colIdx] = getCellDataByType(columns[colIdx].type, newCell);
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
