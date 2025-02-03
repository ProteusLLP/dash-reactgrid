import React, { useEffect, useState, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css";
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';

const locale = window.navigator.language;
const isMacOs = () => window.navigator.appVersion.includes("Mac");

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
  }
}

const getCellValueAsString = (cell) => {
  if (cell.type === "text") return cell.text;
  if (cell.value !== undefined) {
    return cell.value.toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 17 });
  }
  return "";
};

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
    customnumber: new CustomNumberCellTemplate()
  }), []);

  const rows = useMemo(() => (
    [
      { rowId: "header", cells: columns.map(col => ({ type: "header", text: col.title, style: col.headerStyle || {} })) },
      ...gridData.map((row, idx) => ({
        rowId: idx,
        cells: columns.map((col, colIdx) => {
          const cellValue = row[colIdx] || '';
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
      let newData = [...prevData];
      let maxRowId = prevData.length;

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
    for (let row = selectedRange[0].first.row.idx; row <= selectedRange[0].last.row.idx; row++) {
      const tableRow = []
      for (let column = selectedRange[0].first.column.idx; column <= selectedRange[0].last.column.idx; column++) {
        const cellValue = row === 0 ? Headers.title : gridData[row - 1][column];
        tableRow.push(getCellValueAsString({ type: columns[column].type || "text", value: cellValue, text: cellValue }))
      }
      table.push(tableRow.join("\t"))
    }
    return table.join("\n")
  }

  const handleCopy = (e) => {
    const activeSelectedRange = selectedRange;
    if (!activeSelectedRange) {
      return
    }
    const table = selectedRangeToTable(activeSelectedRange);
    console.log(table)
    e.clipboardData.setData("text/plain", table);
    e.preventDefault();
  };

  const handlePaste = (e) => {
    e.stopPropagation()
    e.preventDefault()
    const activeSelectedRange = selectedRange;
    if (!activeSelectedRange) {
      return
    }
    // count the rows in the clipboard
    const htmlData = e.clipboardData.getData("text/html");
    const document = new DOMParser().parseFromString(htmlData, "text/html");
    const hasReactGridAttribute = document.body.firstElementChild?.getAttribute("data-reactgrid") === "reactgrid-content";
    let pastedRows = []
    if (
      hasReactGridAttribute &&
      document.body.firstElementChild?.firstElementChild
    ) {
      const tableRows = document.body.firstElementChild.firstElementChild.children;

      for (let ri = 0; ri < tableRows.length; ri++) {
        const row = [];
        for (let ci = 0; ci < tableRows[ri].children.length; ci++) {
          const rawData =
            tableRows[ri].children[ci].getAttribute("data-reactgrid");
          const data = rawData && JSON.parse(rawData);
          const text = tableRows[ri].children[ci].innerHTML;
          row.push(data ? data : { type: "text", text });
        }
        pastedRows.push(row)
      }
    }
    else {
      pastedRows = e.clipboardData
        .getData("text/plain")
        .replace(/(\r\n)$/, '') // pasting from excel adds an extra row
        .split("\n")
        .map((line) =>
          line
            .split("\t")
            .map((t) => {
              let tnew = t.replace('\r', '');
              return { type: "text", text: tnew }
            })
        )

    }
    setGridData(prevData => {
      let newData = [...prevData];
      let maxRowId = prevData.length;
      // check to see if there are sufficient rows in the table - if not create them
      if (isExtendable) {
        const nNewRows = pastedRows.length - (newData.length - activeSelectedRange[0].first.row.idx) + 1
        if (nNewRows > 0) {
          for (let row = 0; row < nNewRows; row++) {
            newData.push(columns.map(column => null)) // add a blank new row
          }
        }
      }

      pastedRows.forEach((row, ri) => {
        const rowIdx = activeSelectedRange[0].first.row.idx + ri - 1; //-1 for header cell
        if (rowIdx >= newData.length) return;
        row.forEach((cell, ci) => {
          const columnIdx = activeSelectedRange[0].first.column.idx + ci;
          if (columnIdx >= columns.length) return
          newData[rowIdx] = [...newData[rowIdx]];
          newData[rowIdx][columnIdx] = changeCellDataToType(columns[columnIdx].type, cell) || parseToValue(cell.text, columns[columnIdx].type)
        })
      })
      setProps({ data: newData });
      return

    })

    return
  }


  return (
    <div id={id} style={style} className={className}

      onPasteCapture={handlePaste} onCopy={handleCopy} onKeyDown={(e) => {
        if ((!isMacOs() && e.ctrlKey) || e.metaKey) {
          switch (e.key) {
            case "z":
              handleUndoChanges();
              return;
            case "y":
              handleRedoChanges();
              return;
          }
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
        onSelectionChanged={selectedRange => setProps({ selectedRange })}
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
  id: PropTypes.string, // The ID used to identify this component in Dash callbacks
  columns: PropTypes.array.isRequired, // Array of column definitions containing column metadata
  data: PropTypes.array.isRequired, // 2D array representing the grid data
  enableFillHandle: PropTypes.bool, // Enables fill handle for quick copy-pasting of cell values
  enableRangeSelection: PropTypes.bool, // Allows selection of a range of cells
  enableRowSelection: PropTypes.bool, // Enables row selection
  enableColumnSelection: PropTypes.bool, // Enables column selection
  highlights: PropTypes.array, // Array of highlighted cell ranges
  stickyLeftColumns: PropTypes.number, // Number of columns that should remain fixed on the left when scrolling
  stickyRightColumns: PropTypes.number, // Number of columns that should remain fixed on the right when scrolling
  stickyTopRows: PropTypes.number, // Number of rows that should remain fixed on top when scrolling
  stickyBottomRows: PropTypes.number, // Number of rows that should remain fixed at the bottom when scrolling
  isExtendable: PropTypes.bool, // Whether new rows can be added dynamically
  selectedCell: PropTypes.object, // Object representing the currently selected cell
  selectedRange: PropTypes.array, // Object representing the currently selected range of cells
  style: PropTypes.object, // Custom styles applied to the component wrapper
  styleHeader: PropTypes.object, // Custom styles applied to the header row
  className: PropTypes.string, // CSS class applied to the component wrapper
  disableVirtualScrolling: PropTypes.bool, // Disables virtual scrolling for large datasets
  setProps: PropTypes.func, // Dash callback function to update component props
  persistence: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]), // Whether the component's state should persist across sessions
  persistence_type: PropTypes.oneOf(["local", "session", "memory"]), // The storage type used for persistence
  persisted_props: PropTypes.array // List of properties that should persist across sessions
};

export default DashReactGrid;
