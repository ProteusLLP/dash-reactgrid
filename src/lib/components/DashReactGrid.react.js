import React, { useEffect, useState, useMemo, useCallback, use } from 'react';
import PropTypes, { checkPropTypes } from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import { parseLocaleDate} from '../DateUtilities'


const locale = window.navigator.language|| 'en-US'; // Default to 'en-US' if locale is not set

const createCell = (column, value, columnStyle, columnNonEditable, state) => {

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
    case 'checkbox':
      return { type: column.type, checked: Boolean(value), style: columnStyle, nonEditable: columnNonEditable }
    case 'dropdown':{
      const label = Array.isArray(column.values) ? column.values.find(option => option.value === value)?.label || '': '';
      return {type:'dropdown', selectedValue:value, text:label, values:column.values, style:columnStyle, nonEditable:columnNonEditable,isOpen:state?.isOpen||false}
    }
    default:
      return { type: 'text', text: String(value || ''), style: columnStyle, nonEditable: columnNonEditable }
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
    case 'date':{
      return cell.date.toLocaleDateString('en-CA').slice(0,10) || ''; // return date in YYYY-MM-DD format
    }
    case 'checkbox':
      return cell.checked;
    case 'dropdown':
      return cell.selectedValue;
    default:
      return cell.text || cell.value || cell.date || cell.checked || '';
  }
}

const parseToValue = (text, col) => {
  const t = text.trim();
  switch (col.type) {
    case "number":
    case "customnumber":
      return numberParser.parse(t);
    case "percent":
      return percentParser.parse(t);
    case "date":{
      const d = new Date(parseLocaleDate(t,locale))
      return d.toLocaleDateString('en-CA').slice(0,10) || ''; // return date in YYYY-MM-DD format
    }
    case "checkbox":
      return /^(true|1|yes)$/i.test(t)
        ? true
        : /^(false|0|no)$/i.test(t)
        ? false
        : null;
    case "dropdown":{
      // check if the text value is in the list of values
      const options = col.values.map((option) => option.label);
      return options.includes(t) ? col.values.find(option => option.label === t)?.value || '' : null;
    }
    default:
      return t;
  }
};

const getValueAsString = (col,value)=>{
  switch (col.type) {
    case "number":
    case "customnumber":
    case "percent":
      return value?.toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 17 }) || '';
    case "date":
      return value // dates are already stored as strings in YYYY-MM-DD format
    case "checkbox":
      return String(value)
    case "dropdown":{
      return String(col.values.find(option => option.value === value)?.label || '')
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
    default: return { "justifyContent": "flex-start" };
  }
}


function buildCellsFromData(data, columnsMemo,styleHeader) {

  const newCells= [{ rowId: "header", cells: columnsMemo.map(col => ({ type: "header", text: col.title, style: { ...styleHeader, ...col.headerStyle, ...(col.align ? alignToStyle(col.align) : null) } || null })),height:styleHeader?.height},
    ...data.map((row, rowIndex) =>(
    {
        rowId: rowIndex,
        cells:row.map((value, colIndex) => createCell(columnsMemo[colIndex],value,  { ...columnsMemo[colIndex].style, ...(columnsMemo[colIndex].align ? alignToStyle(columnsMemo[colIndex].align) : null) }, columnsMemo[colIndex].nonEditable))
    })
  )];
  return newCells
}


const customCellTemplates ={
  percent: new PercentCellTemplate(),
  customnumber: new CustomNumberCellTemplate(),
  number: new CustomNumberCellTemplate()
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
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [gridData, setData] = useState(()=>data);
  const columnsMemo = useMemo(() => {
    return [...columns]}, [columns]);
  const [cells, setCells] =  useState(() =>
  buildCellsFromData(gridData, columnsMemo, styleHeader)
);

  useEffect(()=>{
    setProps({
      data: gridData})}, [gridData]
  );
  
  
  const applyChanges = (changes) => {
    if (!changes.length) return;
   
    setCells(prevCells => {
      const newCells = [ ...prevCells ];
      setData(prevData => {
      const diff = [];
      const newData = [...prevData];
      let dataChanged=false
      const maxRowId = prevData.length;
    
      changes.forEach(({ rowId, columnId, previousCell,newCell }) => {
        const colIdx = columnsMemo.findIndex(col => col.columnId === columnId);
        if (colIdx !== -1) {
          if (rowId >= maxRowId && isExtendable) {
            // Add new rows if the pasted data exceeds current rows
            while (newData.length <= rowId) {
              newData.push(new Array(columnsMemo.length).fill(null));
              newCells.push({ rowId: newData.length - 1, cells: columnsMemo.map((col) => createCell(col, null, { ...col.style, ...(col.align ? alignToStyle(col.align) : null) }, col.nonEditable)) });
              dataChanged=true
            }
          }
          const previousValue = getCellDataByType(columnsMemo[colIdx].type,previousCell)
          const newValue = getCellDataByType(columnsMemo[colIdx].type,newCell)
          if (previousValue !== newValue) {
            dataChanged=true
            const newDataRow = [...newData[rowId]];
            newDataRow[colIdx] = newValue
            newData[rowId] = newDataRow;
            diff.push({rowId,columnId,previousValue,newValue})
            const newCellsRow =  [...newCells[rowId+1].cells];
            newCellsRow[colIdx] = createCell(columnsMemo[colIdx], newData[rowId][colIdx], { ...columnsMemo[colIdx].style, ...(columnsMemo[colIdx].align ? alignToStyle(columnsMemo[colIdx].align) : null) }, columnsMemo[colIdx].nonEditable );
            newCells[rowId+1] = {rowId:rowId,cells:newCellsRow};
          }
          // Store transient UI state (e.g., isOpen)
          else {if (newCell.isOpen !== undefined) {
            const newCellsRow =  [...newCells[rowId+1].cells];
            newCellsRow[colIdx] = {...createCell(columnsMemo[colIdx], newData[rowId][colIdx], { ...columnsMemo[colIdx].style, ...(columnsMemo[colIdx].align ? alignToStyle(columnsMemo[colIdx].align) : null) }, columnsMemo[colIdx].nonEditable ),isOpen: newCell.isOpen};
            newCells[rowId+1] = {rowId:rowId,cells:newCellsRow};
            const newDataRow = [...newData[rowId]];
            newData[rowId] = newDataRow;
              };
            }
          }

    });
    if (isExtendable) {
      // check to see if rows can be removed
        while (newData.length > 1 && !newData[newData.length - 1].some((v) => v)) {
          newData.pop()
          newCells.pop();
      }
      // check to see if a new row is needed
      
      if (newData[newData.length - 1].some((v) => v)) {
        newData.push(columnsMemo.map((_) => null))
        newCells.push({ rowId: newData.length - 1, cells: columnsMemo.map((col) => createCell(col, null, { ...col.style, ...(col.align ? alignToStyle(col.align) : null) }, col.nonEditable)) });
      }
      if (newData.length!==maxRowId) {
        dataChanged=true
      }
    }
    if (dataChanged) {
      setHistory(prev => [...prev.slice(0, historyIndex + 1), diff]);
      setHistoryIndex(prev => prev + 1)
    };

    return newData;
    });

  return newCells;  
  });
  
    
  }

const selectedRangeToTable = (selectedRange) => {
  const table = []
  for (let row = selectedRange.first.row.idx; row <= selectedRange.last.row.idx; row++) {
    const tableRow = []
    for (let column = selectedRange.first.column.idx; column <= selectedRange.last.column.idx; column++) {
      const cellValue = row === 0 ? columnsMemo[column].title : data[row - 1][column];
      tableRow.push(getValueAsString( columnsMemo[column], cellValue ))
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
      if (colIdx >= columnsMemo.length) return;                 // outside table

      const column   = columnsMemo[colIdx];
      
      // --- previous value on the grid (may be undefined / overflow row) ---
      const prevVal  = data[rowId]?.[colIdx];
      const oldCell  = createCell(column,prevVal)
      // --- value coming from clipboard, coerced to column type -------------
      const coerced  = parseToValue(cell.text, column);
      
      const newCell  = createCell(column,coerced)

      changes.push({
        rowId,
        columnId: column.columnId,
        previousCell: oldCell,
        newCell
      });
    });
  });

  /* -------- 3. Let the existing infrastructure apply & log it -------- */
  applyChanges(changes);
};


const handleUndoChanges = useCallback(() => {
  if (historyIndex < 0) return;                     // nothing to undo
  const batch = history[historyIndex];
  const next = [...gridData];
  batch.forEach(({ rowId, columnId, previousValue }) => {
    const colIdx = columnsMemo.findIndex(c => c.columnId === columnId);
    if (colIdx === -1 || rowId >= next.length) return;

    next[rowId] = [...next[rowId]];
    next[rowId][colIdx] = previousValue;
  });
  setHistoryIndex(prev => prev - 1); // move pointer back
  setData(next);
  setCells(buildCellsFromData(next, columnsMemo,styleHeader)); // update cells to reflect the undo
}, [history,historyIndex,gridData, columnsMemo]);

/* ------------------------------ REDO ------------------------------ */
const handleRedoChanges = useCallback(() => {
  if (historyIndex + 1 >= history.length) return historyIndex;     // nothing to redo
  const nextIdx = historyIndex + 1;
  const batch   = history[nextIdx];

  const next = [...gridData];

  batch.forEach(({ rowId, columnId, newValue }) => {
    const colIdx = columnsMemo.findIndex(c => c.columnId === columnId);
    if (colIdx === -1 || rowId >= next.length) return;

    next[rowId] = [...next[rowId]];
    next[rowId][colIdx] = newValue;
  });
  setHistoryIndex(prev => prev + 1); // move pointer forward
  setData(next);
  setCells(buildCellsFromData(next, columnsMemo,styleHeader)); // update cells to reflect the redo

}, [history,historyIndex,gridData, columnsMemo]);

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
        rows={cells}
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
        onFocusLocationChanged={selectedCell => setProps({ selectedCell: selectedCell })}
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
