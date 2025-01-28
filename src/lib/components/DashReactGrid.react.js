import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid, handlePaste } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css"
import { length } from 'ramda';
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';

const locale = window.navigator.language

const createCellByType = (column, value, columnStyle, columnNonEditable) => {

  switch (column.type) {
    case 'text':
      return { type: column.type, text: value || '', style: columnStyle, nonEditable: columnNonEditable }
    case 'number':
      return { type: 'customnumber', value: value, style: columnStyle, nonEditable: columnNonEditable, format: new Intl.NumberFormat(locale, { ...column.formatOptions }) }
    case 'percent':
      return { type: 'percent', value: value, style: columnStyle, nonEditable: columnNonEditable, format: new Intl.NumberFormat(locale, { ...column.formatOptions, style: "percent" }) }
    case 'date':
      return { type: column.type, date: Date(value), style: columnStyle, nonEditable: columnNonEditable, format: new Intl.DateTimeFormat(locale, { ...column.formatOptions }) }
    case 'time':
      return { type: column.type, time: Date(value), style: columnStyle, nonEditable: columnNonEditable, format: new Intl.DateTimeFormat(locale, { ...column.formatOptions }) }
  }
}

const customCellTemplates = { 'percent': new PercentCellTemplate(), 'customnumber': new CustomNumberCellTemplate() }

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
    case 'time':
      return cell.time
  }
}


const alignToStyle = (align) => {
  switch (align) {
    case "left": return { "justifyContent": "flex-start" };
    case "center": return { "justifyContent": "center" };
    case "right": return { "justifyContent": "flex-end" };
  }
}


const isMacOs = () => window.navigator.appVersion.indexOf("Mac") !== -1;

const DashReactGrid = props => {
  const { id, columns, data, enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, highlights, stickyLeftColumns,
    stickyRightColumns,
    stickyTopRows,
    stickyBottomRows, isExtendable,
    selectedCell, selectedRange, style, styleHeader, className, disableVirtualScrolling, setProps } = props;

  const simpleHandleContextMenu = (
    selectedRowIds,
    selectedColIds,
    selectionMode,
    menuOptions
  ) => {
    return menuOptions;
  }

  return (
    <div id={id} style={style}
    >
      <ReactGridDataHandler data={data} columns={columns} enableFillHandle={enableFillHandle} enableRangeSelection={enableRangeSelection} enableRowSelection={enableRowSelection} enableColumnSelection={enableColumnSelection}
        onContextMenu={simpleHandleContextMenu} highlights={highlights}
        stickyLeftColumns={stickyLeftColumns}
        stickyRightColumns={stickyRightColumns}
        stickyTopRows={stickyTopRows}
        stickyBottomRows={stickyBottomRows}
        isExtendable={isExtendable}
        styleHeader={styleHeader}
        selectedCell={selectedCell}
        selectedRange={selectedRange}
        className={className}
        setProps={setProps}
        disableVirtualScrolling={disableVirtualScrolling}

      />
    </div>
  );
}

DashReactGrid.defaultProps = {
  enableFillHandle: true, enableRangeSelection: true, enableRowSelection: true, enableColumnSelection: true,
  stickyLeftColumns: 0,
  stickyRightColumns: 0,
  stickyTopRows: 0,
  stickyBottomRows: 0,
  highlights: null,
  isExtendable: false,
  className: null,
  disableVirtualScrolling: true,
  persistence_type: 'local',
  persisted_props: ['columns', 'data'],
}

  ;

DashReactGrid.propTypes = {
  /**
   * The ID used to identify this component in Dash callbacks.
   */
  id: PropTypes.string,

  /**
   * A label that will be printed when this component is rendered.
   */
  columns: PropTypes.any.isRequired,

  /**
   * The value displayed in the input.
   */
  data: PropTypes.any.isRequired,


  stickyLeftColumns: PropTypes.number,
  stickyRightColumns: PropTypes.number,
  stickyTopRows: PropTypes.number,
  stickyBottomRows: PropTypes.number,
  enableFillHandle: PropTypes.bool,
  enableRangeSelection: PropTypes.bool,
  enableRowSelection: PropTypes.bool,
  enableColumnSelection: PropTypes.bool,
  highlights: PropTypes.any,
  selectedCell: PropTypes.any,
  /**
   * Whether the table automatically adds extra rows
   */
  isExtendable: PropTypes.bool,
  /**
   * The style of the container (div)
   */
  style: PropTypes.object,
  styleHeader: PropTypes.object,
  className: PropTypes.string,
  disableVirtualScrolling: PropTypes.bool,
  /**
   * Dash-assigned callback that should be called to report property changes
   * to Dash, to make them available for callbacks.
   */
  persistence: PropTypes.oneOfType(
    [PropTypes.bool, PropTypes.string, PropTypes.number]
  ),
  persistence_type: PropTypes.oneOf(['local', 'session', 'memory']),
  persisted_props: PropTypes.arrayOf(PropTypes.oneOf(['columns', 'data]'])),
  setProps: PropTypes.func
};

const ReactGridDataHandler = (props) => {

  const { columns, data, selectedCell, selectedRange, styleHeader, isExtendable, className, highlights, setProps, ...otherProps } = props;
  const columnIds = columns.map((column) => column["columnId"])
  const columnsStyle = columns.map((column) => ({ ...column.align ? alignToStyle(column.align) : null, ...column.style }))
  const createRow = (idx, data_row) => {
    return (
      {
        rowId: idx,
        cells:
          columns.map((column, col_num) => (createCellByType(column, data_row[col_num], columnsStyle[col_num], column.nonEditable)))
      })
  }

  const headerRow = {
    rowId: "header",
    cells: columns.map((column) => (
      {
        type: "header",
        text: column.title,
        style: { ...styleHeader, ...column.headerStyle, ...(column.align ? alignToStyle(column.align) : null) } || null
      }
    )
    ),
    height: styleHeader?.height
  }

  const rows = [
    headerRow,
    ...data.map((data_row, idx) => (
      createRow(idx, data_row)
    ))]
  const [thisRows, setRows] = useState(rows)
  const [thisData, setData] = useState(data)
  const [cellChangesIndex, setCellChangesIndex] = useState(() => -1);
  const [cellChanges, setCellChanges] = useState(() => []);
  const undoChanges = (
    changes, data
  ) => {
    const updated = applyNewValue(changes, data, true);
    setCellChangesIndex(cellChangesIndex - 1);
    return updated;
  };

  const redoChanges = (
    changes, data
  ) => {
    const updated = applyNewValue(changes, data);
    setCellChangesIndex(cellChangesIndex + 1);
    return updated;
  };



  const applyNewValue = (
    changes,
    data,
    usePrevValue = false
  ) => {
    let newData = structuredClone(data);
    changes.forEach((change) => {
      const fieldName = change.columnId;
      const columnIndex = columnIds.indexOf(fieldName)
      const Index = change.rowId;
      const cell = usePrevValue ? change.previousCell : change.newCell;
      if (Index >= length(newData)) {
        const emptyRow = columns.map((column) => null)
        newData.push(...Array(Index - length(newData) + 1).fill(emptyRow))
      }
      newData[Index][columnIndex] = getCellDataByType(columns[columnIndex].type, cell)
    });

    return newData;
  };

  const handleUndoChanges = () => {
    if (cellChangesIndex >= 0) {
      const newData = undoChanges(cellChanges[cellChangesIndex], data)
      createRows(newData)
      setData(newData)
      setProps({ data: newData })
    }
  };

  const handleRedoChanges = () => {
    if (cellChangesIndex + 1 <= cellChanges.length - 1) {
      const newData = redoChanges(cellChanges[cellChangesIndex + 1], data)
      createRows(newData)
      setData(newData)
      setProps({ data: newData })
    }
  };




  const createRows = (data) => {
    (
      setRows([
        headerRow,
        ...data.map((data_row, idx) => (
          createRow(idx, data_row)
        ))])
    )
  };

  const reshapeData = (data) => {
    const newData = structuredClone(data)
    newData.forEach((row) => {
      row.length = columns.length
    })
    setProps({ data: newData })
  }


  useEffect(() => {
    createRows(data)
  }, [data, columns])

  useEffect(() => {
    reshapeData(data)
  }, [columns])

  const applyChanges = (changes, data) => {
    const newData = structuredClone(data);
    changes.forEach((change) => {
      const fieldName = change.columnId;
      const columnIndex = columnIds.indexOf(fieldName)
      const Index = change.rowId;
      newData[Index][columnIndex] = getCellDataByType(columns[columnIndex].type, change.newCell)
    })
    if (isExtendable) {
      //check to see if rows can be removed
      while (newData.length > 1 && !newData[newData.length - 1].some((v) => v)) {
        newData.pop()
      }
      //check to see if a new row is needed
      if (isExtendable && newData[newData.length - 1].some((v) => v)) {
        newData.push(columns.map((column) => null))
      }
    }

    createRows(newData)
    setProps({ data: newData })
    setCellChanges([...cellChanges.slice(0, cellChangesIndex + 1), changes]);
    setCellChangesIndex(cellChangesIndex + 1);
  }


  const handleFocusLocationChanged = location => {
    setProps({ selectedCell: location })
  }


  const handleChanges = (changes) => {
    applyChanges(changes, data)
  };



  const changeCellDataToType = (new_type, cell) => {
    switch (new_type) {
      case 'text':
        return cell.text
      case 'number':
      case 'customnumber':
      case 'percent':
        if (cell.type === 'text') {
          return parseToValue(cell.text, new_type)
        }
        return cell.value || parseToValue(cell.text, new_type)
    }
  }



  const myHandlePaste = (e) => {
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
        .split("\n")
        .map((line) =>
          line
            .split("\t")
            .map((t) => {
              let tnew = t.replace('\r', '');
              return { type: "text", text: tnew }
            })
        )
      // pasting from excel adds an extra row
      pastedRows.pop()
    }
    let newData = structuredClone(data);
    // check to see if there are sufficient rows in the table - if not create them
    if (isExtendable) {
      const nNewRows = pastedRows.length - (thisRows.length - activeSelectedRange[0].first.row.idx) + 1
      if (nNewRows > 0) {
        for (let row = 0; row < nNewRows; row++) {
          newData.push(createEmptyDataRow())
        }
      }
    }



    pastedRows.forEach((row, ri) => {
      const rowIdx = activeSelectedRange[0].first.row.idx + ri - 1; //-1 for header cell
      if (rowIdx >= newData.length) return;
      row.forEach((cell, ci) => {
        const columnIdx = activeSelectedRange[0].first.column.idx + ci;
        if (columnIdx >= columns.length) return
        newData[rowIdx][columnIdx] = changeCellDataToType(columns[columnIdx].type, cell) || parseToValue(cell.text, columns[columnIdx].type)
      })
    })
    createRows(newData)
    setProps({ data: newData })

    return
  }

  const createEmptyDataRow = () => {
    return columns.map((column) => null)
  }

  const parseToValue = (text, type) => {
    switch (type) {
      case "number":
      case "customnumber":
        return numberParser.parse(text)
      case "percent":
        return percentParser.parse(text)
    } return String(text)
  }

  const handleSelectionChanged = e => {
    setProps({ selectedRange: e })
  }

  return (
    <div onPasteCapture={myHandlePaste} onKeyDown={(e) => {
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
    }} >
      <ReactGrid rows={thisRows} columns={props.columns} onCellsChanged={handleChanges} onFocusLocationChanged={handleFocusLocationChanged} enableFillHandle={props.enableFillHandle} enableRangeSelection={props.enableRangeSelection} enableRowSelection={props.enableRowSelection} enableColumnSelection={props.enableColumnSelection}
        onContextMenu={props.simpleHandleContextMenu} highlights={highlights}
        stickyLeftColumns={props.stickyLeftColumns}
        stickyRightColumns={props.stickyRightColumns}
        stickyTopRows={props.stickyTopRows}
        stickyBottomRows={props.stickyBottomRows}
        customCellTemplates={customCellTemplates}
        onSelectionChanged={handleSelectionChanged}
        disableVirtualScrolling={props.disableVirtualScrolling}
        className={className}
      />
    </div>
  )


}
export default DashReactGrid