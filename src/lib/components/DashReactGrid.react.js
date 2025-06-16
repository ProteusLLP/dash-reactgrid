import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import { parseLocaleDate } from '../DateUtilities';

// Constants
const DEFAULT_LOCALE = 'en-US';
const CELL_TYPES = {
  TEXT: 'text',
  NUMBER: 'number',
  CUSTOM_NUMBER: 'customnumber',
  PERCENT: 'percent',
  DATE: 'date',
  CHECKBOX: 'checkbox',
  DROPDOWN: 'dropdown',
  HEADER: 'header'
};

// Utility functions moved outside component to prevent recreation
const getLocale = () => {
  try {
    return window?.navigator?.language || DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

const createAlignmentStyle = (align) => {
  const alignmentMap = {
    left: { justifyContent: "flex-start" },
    center: { justifyContent: "center" },
    right: { justifyContent: "flex-end" }
  };
  return alignmentMap[align] || alignmentMap.left;
};

const createDateCell = (value, style, nonEditable, formatOptions, locale) => {
  try {
    const date = value ? new Date(value) : null;
    return {
      type: CELL_TYPES.DATE,
      date: date && !isNaN(date.getTime()) ? date : null,
      style,
      nonEditable,
      format: new Intl.DateTimeFormat(locale, formatOptions)
    };
  } catch (error) {
    console.warn('Invalid date value:', value, error);
    return {
      type: CELL_TYPES.DATE,
      date: null,
      style,
      nonEditable,
      format: new Intl.DateTimeFormat(locale, formatOptions)
    };
  }
};

const createDropdownCell = (column, value, style, nonEditable, state) => {
  const values = Array.isArray(column.values) ? column.values : [];
  const selectedOption = values.find(option => option?.value === value);
  const label = selectedOption?.label || '';
  
  return {
    type: CELL_TYPES.DROPDOWN,
    selectedValue: value,
    text: label,
    values,
    style,
    nonEditable,
    isOpen: state?.isOpen || false
  };
};

const createCell = (column, value, columnStyle, columnNonEditable, state, locale) => {
  const style = columnStyle;
  const nonEditable = columnNonEditable;

  try {
    switch (column.type) {
      case CELL_TYPES.TEXT:
        return {
          type: CELL_TYPES.TEXT,
          text: String(value || ''),
          style,
          nonEditable
        };

      case CELL_TYPES.NUMBER:
        return {
          type: CELL_TYPES.CUSTOM_NUMBER,
          value: value,
          style,
          nonEditable,
          format: new Intl.NumberFormat(locale, column.formatOptions || {})
        };

      case CELL_TYPES.PERCENT:
        return {
          type: CELL_TYPES.PERCENT,
          value: value,
          style,
          nonEditable,
          format: new Intl.NumberFormat(locale, {
            ...column.formatOptions,
            style: "percent"
          })
        };

      case CELL_TYPES.DATE:
        return createDateCell(value, style, nonEditable, column.formatOptions || {}, locale);

      case CELL_TYPES.CHECKBOX:
        return {
          type: CELL_TYPES.CHECKBOX,
          checked: Boolean(value),
          style,
          nonEditable
        };

      case CELL_TYPES.DROPDOWN:
        return createDropdownCell(column, value, style, nonEditable, state);

      default:
        return {
          type: CELL_TYPES.TEXT,
          text: String(value || ''),
          style,
          nonEditable
        };
    }
  } catch (error) {
    console.warn('Error creating cell:', error, { column, value });
    return {
      type: CELL_TYPES.TEXT,
      text: String(value || ''),
      style,
      nonEditable
    };
  }
};

const getCellDataByType = (type, cell) => {
  try {
    switch (type) {
      case CELL_TYPES.TEXT:
        return cell.text || '';
      case CELL_TYPES.NUMBER:
      case CELL_TYPES.CUSTOM_NUMBER:
      case CELL_TYPES.PERCENT:
        return cell.value;
      case CELL_TYPES.DATE:
        return cell.date?.toISOString().slice(0, 10) || '';
      case CELL_TYPES.CHECKBOX:
        return cell.checked;
      case CELL_TYPES.DROPDOWN:
        return cell.selectedValue;
      default:
        return cell.text || cell.value || '';
    }
  } catch (error) {
    console.warn('Error getting cell data:', error, { type, cell });
    return '';
  }
};

const parseToValue = (text, column, locale) => {
  if (!text || typeof text !== 'string') return null;
  
  const trimmedText = text.trim();
  if (!trimmedText) return null;

  try {
    switch (column.type) {
      case CELL_TYPES.NUMBER:
      case CELL_TYPES.CUSTOM_NUMBER:
        return numberParser.parse(trimmedText);

      case CELL_TYPES.PERCENT:
        return percentParser.parse(trimmedText);

      case CELL_TYPES.DATE: {
        const parsedDate = new Date(parseLocaleDate(trimmedText, locale));
        return isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString().slice(0, 10);
      }

      case CELL_TYPES.CHECKBOX:
        return /^(true|1|yes)$/i.test(trimmedText) ? true :
               /^(false|0|no)$/i.test(trimmedText) ? false : null;

      case CELL_TYPES.DROPDOWN: {
        const values = Array.isArray(column.values) ? column.values : [];
        const matchingOption = values.find(option => option?.label === trimmedText);
        return matchingOption?.value || null;
      }

      default:
        return trimmedText;
    }
  } catch (error) {
    console.warn('Error parsing value:', error, { text: trimmedText, column });
    return trimmedText;
  }
};

const getValueAsString = (column, value, locale) => {
  if (value == null) return '';

  try {
    switch (column.type) {
      case CELL_TYPES.NUMBER:
      case CELL_TYPES.CUSTOM_NUMBER:
      case CELL_TYPES.PERCENT:
        return typeof value === 'number' 
          ? value.toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 17 })
          : '';

      case CELL_TYPES.DATE: {
        const date = new Date(value);
        return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
      }

      case CELL_TYPES.CHECKBOX:
        return String(value);

      case CELL_TYPES.DROPDOWN: {
        const values = Array.isArray(column.values) ? column.values : [];
        const option = values.find(opt => opt?.value === value);
        return option?.label || '';
      }

      default:
        return String(value);
    }
  } catch (error) {
    console.warn('Error converting value to string:', error, { column, value });
    return String(value);
  }
};

// Memoized cell building function
const buildCellsFromData = (data, columns, styleHeader, locale) => {
  if (!Array.isArray(data) || !Array.isArray(columns)) {
    return [];
  }

  try {
    const headerCells = columns.map(col => ({
      type: CELL_TYPES.HEADER,
      text: col?.title || '',
      style: {
        ...styleHeader,
        ...col?.headerStyle,
        ...(col?.align ? createAlignmentStyle(col.align) : {})
      }
    }));

    const headerRow = {
      rowId: "header",
      cells: headerCells,
      height: styleHeader?.height
    };

    const dataRows = data.map((row, rowIndex) => {
      if (!Array.isArray(row)) {
        console.warn(`Row ${rowIndex} is not an array:`, row);
        return {
          rowId: rowIndex,
          cells: columns.map(() => createCell({ type: CELL_TYPES.TEXT }, '', {}, false, null, locale))
        };
      }

      const cells = row.map((value, colIndex) => {
        const column = columns[colIndex];
        if (!column) {
          console.warn(`Column ${colIndex} not found for row ${rowIndex}`);
          return createCell({ type: CELL_TYPES.TEXT }, value, {}, false, null, locale);
        }

        const cellStyle = {
          ...column.style,
          ...(column.align ? createAlignmentStyle(column.align) : {})
        };

        return createCell(column, value, cellStyle, column.nonEditable, null, locale);
      });

      return {
        rowId: rowIndex,
        cells
      };
    });

    return [headerRow, ...dataRows];
  } catch (error) {
    console.error('Error building cells from data:', error);
    return [];
  }
};

/**
 * DashReactGrid is a high-performance wrapper around the ReactGrid component 
 * that provides seamless integration with Dash applications.
 */
const DashReactGrid = ({
  id,
  columns = [],
  data = [],
  enableFillHandle = true,
  enableRangeSelection = true,
  enableRowSelection = false,
  enableColumnSelection = false,
  highlights = null,
  stickyLeftColumns = 0,
  stickyRightColumns = 0,
  stickyTopRows = 0,
  stickyBottomRows = 0,
  isExtendable = false,
  selectedCell,
  selectedRange,
  style,
  styleHeader,
  className,
  disableVirtualScrolling = false,
  setProps,
  persistence,
  persistence_type = 'local',
  persisted_props = ['columns', 'data']
}) => {
  // Refs for stable references
  const setPropsRef = useRef(setProps);
  const columnsRef = useRef(columns);
  const localeRef = useRef(getLocale());

  // Update refs when props change
  useEffect(() => {
    setPropsRef.current = setProps;
    columnsRef.current = columns;
  });

  // State management
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [gridData, setGridData] = useState(() => {
    // Ensure data is properly formatted
    return Array.isArray(data) ? data.map(row => 
      Array.isArray(row) ? [...row] : []
    ) : [];
  });
  const [cells, setCells] = useState(() => 
    buildCellsFromData(gridData, columns, styleHeader, localeRef.current)
  );

  // Memoized custom cell templates
  const customCellTemplates = useMemo(() => ({
    [CELL_TYPES.PERCENT]: new PercentCellTemplate(),
    [CELL_TYPES.CUSTOM_NUMBER]: new CustomNumberCellTemplate(),
    [CELL_TYPES.NUMBER]: new CustomNumberCellTemplate()
  }), []);

  // Sync gridData with external data prop changes
  useEffect(() => {
    if (Array.isArray(data)) {
      const formattedData = data.map(row => 
        Array.isArray(row) ? [...row] : []
      );
      setGridData(formattedData);
      setCells(buildCellsFromData(formattedData, columns, styleHeader, localeRef.current));
    }
  }, [data, columns, styleHeader]);

  // Notify parent of data changes
  useEffect(() => {
    if (setPropsRef.current && gridData !== data) {
      setPropsRef.current({ data: gridData });
    }
  }, [gridData, data]);

  // Optimized change application with UI state handling
  const applyChanges = useCallback((changes) => {
    if (!Array.isArray(changes) || changes.length === 0) return;

    setCells(prevCells => {
      const newCells = [...prevCells];
      
      setGridData(prevData => {
        const newData = prevData.map(row => [...row]);
        const diff = [];
        let dataChanged = false;
        const maxRowId = prevData.length;

        changes.forEach(({ rowId, columnId, previousCell, newCell }) => {
          const colIdx = columns.findIndex(col => col?.columnId === columnId);
          if (colIdx === -1) return;

          const column = columns[colIdx];

          // Handle row extension
          if (rowId >= maxRowId && isExtendable) {
            while (newData.length <= rowId) {
              newData.push(new Array(columns.length).fill(null));
              newCells.push({
                rowId: newData.length - 1,
                cells: columns.map((col) => createCell(
                  col, 
                  null, 
                  { ...col.style, ...(col.align ? createAlignmentStyle(col.align) : {}) }, 
                  col.nonEditable,
                  null,
                  localeRef.current
                ))
              });
              dataChanged = true;
            }
          }

          if (rowId >= newData.length) return;

          const previousValue = getCellDataByType(column.type, previousCell);
          const newValue = getCellDataByType(column.type, newCell);

          if (previousValue !== newValue) {
            newData[rowId] = [...newData[rowId]];
            newData[rowId][colIdx] = newValue;
            dataChanged = true;

            diff.push({
              rowId,
              columnId,
              previousValue,
              newValue
            });

            // Update the corresponding cell in newCells
            const newCellsRow = [...newCells[rowId + 1].cells];
            newCellsRow[colIdx] = createCell(
              column, 
              newData[rowId][colIdx], 
              { ...column.style, ...(column.align ? createAlignmentStyle(column.align) : {}) }, 
              column.nonEditable,
              null,
              localeRef.current
            );
            newCells[rowId + 1] = { rowId: rowId, cells: newCellsRow };
          }
          // Handle transient UI state changes (like dropdown isOpen)
          else if (newCell.isOpen !== undefined) {
            const newCellsRow = [...newCells[rowId + 1].cells];
            newCellsRow[colIdx] = {
              ...createCell(
                column, 
                newData[rowId][colIdx], 
                { ...column.style, ...(column.align ? createAlignmentStyle(column.align) : {}) }, 
                column.nonEditable,
                null,
                localeRef.current
              ),
              isOpen: newCell.isOpen
            };
            newCells[rowId + 1] = { rowId: rowId, cells: newCellsRow };
          }
        });

        // Handle row cleanup for extendable grids
        if (isExtendable) {
          while (newData.length > 1 && !newData[newData.length - 1].some(v => v != null)) {
            newData.pop();
            newCells.pop();
            dataChanged = true;
          }

          if (newData.length > 0 && newData[newData.length - 1].some(v => v != null)) {
            newData.push(new Array(columns.length).fill(null));
            newCells.push({
              rowId: newData.length - 1,
              cells: columns.map((col) => createCell(
                col, 
                null, 
                { ...col.style, ...(col.align ? createAlignmentStyle(col.align) : {}) }, 
                col.nonEditable,
                null,
                localeRef.current
              ))
            });
            dataChanged = true;
          }
        }

        // Update history
        if (dataChanged && diff.length > 0) {
          setHistory(prev => [...prev.slice(0, historyIndex + 1), diff]);
          setHistoryIndex(prev => prev + 1);
        }

        return newData;
      });

      return newCells;
    });
  }, [columns, isExtendable, historyIndex]);

  // Optimized clipboard operations
  const selectedRangeToTable = useCallback((selectedRange) => {
    if (!selectedRange?.first || !selectedRange?.last) return '';

    const table = [];
    const { first, last } = selectedRange;

    for (let row = first.row.idx; row <= last.row.idx; row++) {
      const tableRow = [];
      for (let column = first.column.idx; column <= last.column.idx; column++) {
        const cellValue = row === 0 
          ? columns[column]?.title || ''
          : gridData[row - 1]?.[column];
        
        tableRow.push(getValueAsString(columns[column] || {}, cellValue, localeRef.current));
      }
      table.push(tableRow.join("\t"));
    }
    return table.join("\n");
  }, [columns, gridData]);

  const handleCopy = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const activeSelectedRange = selectedRange?.[0];
    if (!activeSelectedRange) return;
    
    const table = selectedRangeToTable(activeSelectedRange);
    e.clipboardData.setData("text/plain", table);
  }, [selectedRange, selectedRangeToTable]);

  const handlePaste = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const activeRange = selectedRange?.[0];
    if (!activeRange) return;

    try {
      // Parse clipboard data
      const htmlData = e.clipboardData.getData("text/html");
      const doc = new DOMParser().parseFromString(htmlData, "text/html");
      const isRGHtml = doc.body.firstElementChild?.getAttribute("data-reactgrid") === "reactgrid-content";

      let pastedRows = [];

      if (isRGHtml && doc.body.firstElementChild?.firstElementChild) {
        // Handle ReactGrid HTML format
        const tableRows = doc.body.firstElementChild.firstElementChild.children;
        
        for (let ri = 0; ri < tableRows.length; ri++) {
          const row = [];
          for (let ci = 0; ci < tableRows[ri].children.length; ci++) {
            const raw = tableRows[ri].children[ci].getAttribute("data-reactgrid");
            const cellData = raw ? JSON.parse(raw) : null;
            const text = tableRows[ri].children[ci].innerHTML;
            row.push(cellData || { type: CELL_TYPES.TEXT, text });
          }
          pastedRows.push(row);
        }
      } else {
        // Handle plain text format
        pastedRows = e.clipboardData
          .getData("text/plain")
          .replace(/(\r\n)$/, "")
          .split("\n")
          .map(line =>
            line.split("\t").map(t => ({ 
              type: CELL_TYPES.TEXT, 
              text: t.replace("\r", "") 
            }))
          );
      }

      if (pastedRows.length === 0) return;

      // Build changes
      const changes = [];
      pastedRows.forEach((row, ri) => {
        const rowId = activeRange.first.row.idx + ri - 1;
        
        row.forEach((cell, ci) => {
          const colIdx = activeRange.first.column.idx + ci;
          if (colIdx >= columns.length) return;

          const column = columns[colIdx];
          const prevVal = gridData[rowId]?.[colIdx];
          const coerced = parseToValue(cell.text, column, localeRef.current);
          
          const oldCell = createCell(column, prevVal, {}, false, null, localeRef.current);
          const newCell = createCell(column, coerced, {}, false, null, localeRef.current);

          changes.push({
            rowId,
            columnId: column.columnId,
            previousCell: oldCell,
            newCell
          });
        });
      });

      applyChanges(changes);
    } catch (error) {
      console.error('Error handling paste:', error);
    }
  }, [selectedRange, columns, gridData, applyChanges]);

  // Undo/Redo functionality
  const handleUndoChanges = useCallback(() => {
    if (historyIndex < 0) return;
    
    const batch = history[historyIndex];
    setGridData(prevData => {
      const newData = prevData.map(row => [...row]);
      
      batch.forEach(({ rowId, columnId, previousValue }) => {
        const colIdx = columns.findIndex(c => c?.columnId === columnId);
        if (colIdx === -1 || rowId >= newData.length) return;
        
        newData[rowId][colIdx] = previousValue;
      });
      
      return newData;
    });
    
    setCells(prevCells => buildCellsFromData(gridData, columns, styleHeader, localeRef.current));
    setHistoryIndex(prev => prev - 1);
  }, [history, historyIndex, columns, gridData, styleHeader]);

  const handleRedoChanges = useCallback(() => {
    if (historyIndex + 1 >= history.length) return;
    
    const nextIdx = historyIndex + 1;
    const batch = history[nextIdx];
    
    setGridData(prevData => {
      const newData = prevData.map(row => [...row]);
      
      batch.forEach(({ rowId, columnId, newValue }) => {
        const colIdx = columns.findIndex(c => c?.columnId === columnId);
        if (colIdx === -1 || rowId >= newData.length) return;
        
        newData[rowId][colIdx] = newValue;
      });
      
      return newData;
    });
    
    setCells(prevCells => buildCellsFromData(gridData, columns, styleHeader, localeRef.current));
    setHistoryIndex(prev => prev + 1);
  }, [history, historyIndex, columns, gridData, styleHeader]);

  // Keyboard event handler
  const handleKeyDown = useCallback((e) => {
    const isCtrlOrCmd = e.metaKey || e.ctrlKey;
    
    if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndoChanges();
    } else if (isCtrlOrCmd && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      handleRedoChanges();
    }
  }, [handleUndoChanges, handleRedoChanges]);

  // Selection change handlers
  const handleSelectionChanged = useCallback((newSelectedRange) => {
    if (setPropsRef.current) {
      setPropsRef.current({ selectedRange: newSelectedRange });
    }
  }, []);

  const handleSelectionChanging = useCallback((newSelectedRange) => {
    if (setPropsRef.current) {
      setPropsRef.current({ selectedRange: newSelectedRange });
    }
    return true;
  }, []);

  const handleFocusLocationChanged = useCallback((newSelectedCell) => {
    if (setPropsRef.current) {
      setPropsRef.current({ selectedCell: newSelectedCell });
    }
  }, []);

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

DashReactGrid.propTypes = {
  id: PropTypes.string,
  columns: PropTypes.arrayOf(PropTypes.shape({
    columnId: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    type: PropTypes.oneOf(Object.values(CELL_TYPES)),
    align: PropTypes.oneOf(['left', 'center', 'right']),
    style: PropTypes.object,
    headerStyle: PropTypes.object,
    nonEditable: PropTypes.bool,
    formatOptions: PropTypes.object,
    values: PropTypes.arrayOf(PropTypes.shape({
      value: PropTypes.any,
      label: PropTypes.string
    }))
  })).isRequired,
  data: PropTypes.arrayOf(PropTypes.array).isRequired,
  enableFillHandle: PropTypes.bool,
  enableRangeSelection: PropTypes.bool,
  enableRowSelection: PropTypes.bool,
  enableColumnSelection: PropTypes.bool,
  highlights: PropTypes.array,
  stickyLeftColumns: PropTypes.number,
  stickyRightColumns: PropTypes.number,
  stickyTopRows: PropTypes.number,
  stickyBottomRows: PropTypes.number,
  isExtendable: PropTypes.bool,
  selectedCell: PropTypes.object,
  selectedRange: PropTypes.array,
  style: PropTypes.object,
  styleHeader: PropTypes.object,
  className: PropTypes.string,
  disableVirtualScrolling: PropTypes.bool,
  setProps: PropTypes.func,
  persistence: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
  persistence_type: PropTypes.oneOf(["local", "session", "memory"]),
  persisted_props: PropTypes.array
};

export default DashReactGrid;