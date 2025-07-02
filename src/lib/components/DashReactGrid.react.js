import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import { parseLocaleDate } from '../DateUtilities';


const locale = window.navigator.language || 'en-US';

// Performance constants
const THROTTLE_DELAY = 16; // ~60fps throttling for data updates

// Memoized cell creation to avoid recreating cells on every render
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
      return {
        type:'dropdown', 
        selectedValue: value, 
        text: label, 
        values: column.values, 
        style: columnStyle, 
        nonEditable: columnNonEditable,
        isOpen: state?.isOpen || false
      }
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


// Optimized cell building with memoization for better performance on large grids
function buildCellsFromData(data, columnsMemo, styleHeader) {
  const headerCells = columnsMemo.map(col => ({ 
    type: "header", 
    text: col.title, 
    style: { 
      ...styleHeader, 
      ...col.headerStyle, 
      ...(col.align ? alignToStyle(col.align) : null) 
    } || null 
  }));

  const newCells = [
    { rowId: "header", cells: headerCells, height: styleHeader?.height },
    ...data.map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const col = columnsMemo[colIndex];
        return createCell(
          col,
          value,
          { ...col.style, ...(col.align ? alignToStyle(col.align) : null) },
          col.nonEditable
        );
      });
      return { rowId: rowIndex, cells };
    })
  ];
  
  return newCells;
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
  // Memoize columns with performance optimization for large datasets
  const columnsMemo = useMemo(() => [...columns], [columns]);

  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [gridData, setData] = useState(() => data);
  const [cells, setCells] = useState(() => buildCellsFromData(data, columnsMemo, styleHeader));
  
  // Create a column lookup map for O(1) access instead of O(n) findIndex
  const columnLookup = useMemo(() => {
    const lookup = new Map();
    columnsMemo.forEach((col, index) => {
      lookup.set(col.columnId, index);
    });
    return lookup;
  }, [columnsMemo]);

  // Throttled data update to prevent excessive prop updates
  const updateDataRef = useRef(null);
  useEffect(() => {
    if (updateDataRef.current) {
      clearTimeout(updateDataRef.current);
    }
    updateDataRef.current = setTimeout(() => {
      setProps({ data: gridData });
    }, THROTTLE_DELAY);
    
    return () => {
      if (updateDataRef.current) {
        clearTimeout(updateDataRef.current);
      }
    };
  }, [gridData, setProps]);

  // Sync external data changes
  useEffect(() => {
    setData(data);
    setCells(buildCellsFromData(data, columnsMemo, styleHeader));
  }, [data, columnsMemo, styleHeader]);
  
  // Apply changes function matching the original working implementation
  const applyChanges = useCallback((changes) => {
    if (!changes.length) {
      return;
    }
   
    setCells(prevCells => {
      const newCells = [...prevCells];
      
      setData(prevData => {
        const diff = [];
        const newData = [...prevData];
        let dataChanged = false;
        const maxRowId = prevData.length;
      
        changes.forEach(({ rowId, columnId, previousCell, newCell }) => {
          const colIdx = columnLookup.get(columnId);
          if (typeof colIdx === 'number') {
            // Skip invalid row IDs
            if (rowId < 0) {
              return;
            }
            
            // For non-extendable grids, skip rows beyond current boundaries
            if (!isExtendable && rowId >= maxRowId) {
              return;
            }
            
            if (rowId >= maxRowId && isExtendable) {
              // Add new rows if the pasted data exceeds current rows
              while (newData.length <= rowId) {
                newData.push(new Array(columnsMemo.length).fill(null));
                newCells.push({ 
                  rowId: newData.length - 1, 
                  cells: columnsMemo.map((col) => createCell(col, null, { ...col.style, ...(col.align ? alignToStyle(col.align) : null) }, col.nonEditable)) 
                });
                dataChanged = true;
              }
            }
            
            const previousValue = getCellDataByType(columnsMemo[colIdx].type, previousCell);
            const newValue = getCellDataByType(columnsMemo[colIdx].type, newCell);
            
            if (previousValue !== newValue) {
              dataChanged = true;
              newData[rowId] = [...newData[rowId]];
              newData[rowId][colIdx] = newValue;
              diff.push({ rowId, columnId, previousValue, newValue });
              
              // Update the cell in the grid
              const newCellsRow = [...newCells[rowId + 1].cells];
              newCellsRow[colIdx] = createCell(columnsMemo[colIdx], newData[rowId][colIdx], 
                { ...columnsMemo[colIdx].style, ...(columnsMemo[colIdx].align ? alignToStyle(columnsMemo[colIdx].align) : null) }, 
                columnsMemo[colIdx].nonEditable);
              newCells[rowId + 1] = { rowId: rowId, cells: newCellsRow };
            }
            // Store transient UI state (e.g., isOpen for dropdowns)
            else if ('isOpen' in newCell) {
              const newCellsRow = [...newCells[rowId + 1].cells];
              newCellsRow[colIdx] = {
                ...createCell(columnsMemo[colIdx], newData[rowId][colIdx], 
                  { ...columnsMemo[colIdx].style, ...(columnsMemo[colIdx].align ? alignToStyle(columnsMemo[colIdx].align) : null) }, 
                  columnsMemo[colIdx].nonEditable),
                isOpen: newCell.isOpen
              };
              newCells[rowId + 1] = { rowId: rowId, cells: newCellsRow };
            }
          }
        });
      
        if (isExtendable) {
          // Check to see if rows can be removed
          while (newData.length > 1 && !newData[newData.length - 1].some((v) => v)) {
            newData.pop();
            newCells.pop();
          }
          // Check to see if a new row is needed
          if (newData.length > 0 && newData[newData.length - 1].some((v) => v)) {
            newData.push(columnsMemo.map((_) => null));
            newCells.push({ 
              rowId: newData.length - 1, 
              cells: columnsMemo.map((col) => createCell(col, null, { ...col.style, ...(col.align ? alignToStyle(col.align) : null) }, col.nonEditable)) 
            });
          }
          if (newData.length !== maxRowId) {
            dataChanged = true;
          }
        }
        
        if (dataChanged) {
          setHistory(prev => [...prev.slice(0, historyIndex + 1), diff]);
          setHistoryIndex(prev => prev + 1);
        }

        return newData;
      });

      return newCells;  
    });
  }, [columnLookup, columnsMemo, isExtendable, historyIndex]);

  // Memoized selectedRangeToTable for better performance
  const selectedRangeToTable = useCallback((selectedRange) => {
    const table = [];
    for (let row = selectedRange.first.row.idx; row <= selectedRange.last.row.idx; row++) {
      const tableRow = [];
      for (let column = selectedRange.first.column.idx; column <= selectedRange.last.column.idx; column++) {
        const cellValue = row === 0 ? columnsMemo[column].title : gridData[row - 1][column];
        tableRow.push(getValueAsString(columnsMemo[column], cellValue));
      }
      table.push(tableRow.join("\t"));
    }
    return table.join("\n");
  }, [columnsMemo, gridData]);

  // Optimized copy handler
  const handleCopy = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const activeSelectedRange = selectedRange?.[0];
    if (!activeSelectedRange) {
      return;
    }
    const table = selectedRangeToTable(activeSelectedRange);
    e.clipboardData.setData("text/plain", table);
  }, [selectedRange, selectedRangeToTable]);

  // Optimized paste handler with better performance
  const handlePaste = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const activeRange = selectedRange?.[0];
    if (!activeRange) {
      return;
    }

    const htmlData = e.clipboardData.getData("text/html");
    const doc = new DOMParser().parseFromString(htmlData, "text/html");
    const isRGHtml = doc.body.firstElementChild?.getAttribute("data-reactgrid") === "reactgrid-content";

    let pastedRows = [];

    if (isRGHtml && doc.body.firstElementChild?.firstElementChild) {
      const tableRows = doc.body.firstElementChild.firstElementChild.children;

      for (let ri = 0; ri < tableRows.length; ri++) {
        const row = [];
        for (let ci = 0; ci < tableRows[ri].children.length; ci++) {
          const raw = tableRows[ri].children[ci].getAttribute("data-reactgrid");
          const cellData = raw && JSON.parse(raw);
          const text = tableRows[ri].children[ci].innerHTML;
          row.push(cellData ? cellData : { type: "text", text });
        }
        pastedRows.push(row);
      }
    } else {
      pastedRows = e.clipboardData
        .getData("text/plain")
        .replace(/(\r\n)$/, "")
        .split("\n")
        .map(line =>
          line
            .split("\t")
            .map(t => ({ type: "text", text: t.replace("\r", "") }))
        );
    }

    if (!pastedRows.length) {
      return;
    }

    const changes = [];

    pastedRows.forEach((row, ri) => {
      const rowId = activeRange.first.row.idx + ri - 1;

      // Skip if rowId is invalid (negative or beyond grid boundaries when not extendable)
      if (rowId < 0) {
        return;
      }
      
      // For non-extendable grids, skip rows beyond current grid size
      if (!isExtendable && rowId >= gridData.length) {
        return;
      }

      row.forEach((cell, ci) => {
        const colIdx = activeRange.first.column.idx + ci;
        
        // Skip if column index exceeds grid boundaries
        if (colIdx >= columnsMemo.length) {
          return;
        }

        const column = columnsMemo[colIdx];
        
        // Get previous value safely - handle case where row doesn't exist yet
        const prevVal = gridData[rowId]?.[colIdx] || null;
        const oldCell = createCell(column, prevVal);
        const coerced = parseToValue(cell.text, column);
        const newCell = createCell(column, coerced);

        changes.push({
          rowId,
          columnId: column.columnId,
          previousCell: oldCell,
          newCell
        });
      });
    });

    applyChanges(changes);
  }, [selectedRange, columnsMemo, gridData, applyChanges]);


  // Optimized undo function
  const handleUndoChanges = useCallback(() => {
    if (historyIndex < 0) {
      return;
    }
    const batch = history[historyIndex];
    const next = gridData.map(row => [...row]);
    
    batch.forEach(({ rowId, columnId, previousValue }) => {
      const colIdx = columnLookup.get(columnId);
      if (typeof colIdx === 'number' && rowId < next.length) {
        next[rowId][colIdx] = previousValue;
      }
    });
    
    setHistoryIndex(prev => prev - 1);
    setData(next);
  }, [history, historyIndex, gridData, columnLookup]);

  // Optimized redo function
  const handleRedoChanges = useCallback(() => {
    if (historyIndex + 1 >= history.length) {
      return;
    }
    const nextIdx = historyIndex + 1;
    const batch = history[nextIdx];
    const next = gridData.map(row => [...row]);

    batch.forEach(({ rowId, columnId, newValue }) => {
      const colIdx = columnLookup.get(columnId);
      if (typeof colIdx === 'number' && rowId < next.length) {
        next[rowId][colIdx] = newValue;
      }
    });
    
    setHistoryIndex(prev => prev + 1);
    setData(next);
  }, [history, historyIndex, gridData, columnLookup]);

  // Memoized keyboard event handler
  const handleKeyDown = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      handleUndoChanges();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      handleRedoChanges();
    }
  }, [handleUndoChanges, handleRedoChanges]);

  // Memoized selection change handler
  const handleSelectionChanged = useCallback((selectedRange) => {
    setProps({ selectedRange });
  }, [setProps]);

  const handleSelectionChanging = useCallback((selectedRange) => {
    setProps({ selectedRange });
    return true;
  }, [setProps]);

  const handleFocusLocationChanged = useCallback((selectedCell) => {
    setProps({ selectedCell });
  }, [setProps]);

  return (
    <div 
      id={id} 
      style={style} 
      className={className} 
      tabIndex={0}
      onPasteCapture={handlePaste} 
      onCopyCapture={handleCopy} 
      onKeyDownCapture={handleKeyDown}
    >
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
        onSelectionChanged={handleSelectionChanged}
        onSelectionChanging={handleSelectionChanging}
        onFocusLocationChanged={handleFocusLocationChanged}
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
