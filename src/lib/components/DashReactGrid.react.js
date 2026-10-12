import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css"
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import {
  GHOST_ROW_ID,
  applyChanges,
  blankRow,
  columnClass,
  optionsOf,
  pastedValue,
  removeRows,
  rowIdsOf,
  rowsInRanges,
  rulesHold,
  stickyCounts,
  textOf,
  valueOf,
} from '../model';

const locale = window.navigator.language
const parsers = { number: numberParser, percent: percentParser }
const customCellTemplates = { 'percent': new PercentCellTemplate(), 'customnumber': new CustomNumberCellTemplate() }
const DELETE_ROWS_OPTION = "deleteRows"
const NO_HISTORY = { changes: [], index: -1 }

const alignToStyle = (align) => {
  switch (align) {
    case "left": return { "justifyContent": "flex-start" };
    case "center": return { "justifyContent": "center" };
    case "right": return { "justifyContent": "flex-end" };
  }
  return null
}

const isMacOs = () => window.navigator.appVersion.indexOf("Mac") !== -1;

/** The ReactGrid cell showing one value of a column. */
const createCell = (column, value, style, locked, isOpen) => {
  const base = { style, nonEditable: locked, className: [column.className, columnClass(column.columnId)].filter(Boolean).join(' ') }
  switch (column.type) {
    case 'number':
      return { ...base, type: 'customnumber', value: value ?? NaN, format: new Intl.NumberFormat(locale, { ...column.formatOptions }) }
    case 'percent':
      return { ...base, type: 'percent', value: value ?? NaN, format: new Intl.NumberFormat(locale, { ...column.formatOptions, style: "percent" }) }
    case 'dropdown':
      return { ...base, type: 'dropdown', selectedValue: value ?? undefined, values: optionsOf(column), isOpen, isDisabled: locked }
    case 'checkbox':
      return { ...base, type: 'checkbox', checked: Boolean(value) }
    case 'date':
      return { ...base, type: 'date', date: value ? new Date(value) : undefined, format: new Intl.DateTimeFormat(locale, { ...column.formatOptions }) }
    case 'time':
      return { ...base, type: 'time', time: value ? new Date(value) : undefined, format: new Intl.DateTimeFormat(locale, { ...column.formatOptions }) }
    default:
      return { ...base, type: 'text', text: value == null ? '' : String(value) }
  }
}

const DashReactGrid = props => {
  const { id, style, className } = props;
  // ReactGrid ignores a class name, so it goes on the container.
  return (
    <div id={typeof id === 'object' ? JSON.stringify(id) : id} style={style} className={className || undefined}>
      <ReactGridDataHandler {...props} />
    </div>
  );
}

const ReactGridDataHandler = (props) => {
  const { columns: allColumns, data, rowIds, newRow, lockedCells, readOnly, hiddenColumns, styleHeader, isExtendable, highlights, setProps } = props;

  // Hidden columns keep their place in `data`; the grid sees only the rest.
  const columns = useMemo(() => {
    const hidden = new Set(hiddenColumns || [])
    return allColumns.filter((column) => !hidden.has(column.columnId))
  }, [allColumns, hiddenColumns])
  const allColumnIds = allColumns.map((column) => column.columnId)

  const tracked = Array.isArray(rowIds)
  const table = useMemo(() => ({ data, rowIds: rowIdsOf(data, rowIds) }), [data, rowIds])
  const extendable = isExtendable && !readOnly
  const columnIds = columns.map((column) => column.columnId)

  const [openDropdown, setOpenDropdown] = useState(null)
  const [history, setHistory] = useState(NO_HISTORY)
  const selection = useRef(null)
  const sequence = useRef(0)

  // The server sends new columns only when it remounts the table, which
  // starts a new history; the grid's own changes never touch them.
  useEffect(() => setHistory(NO_HISTORY), [allColumns])

  const locked = useMemo(
    () => new Set((lockedCells || []).map(([rowId, columnId]) => `${rowId}\u0000${columnId}`)),
    [lockedCells],
  )
  const isLocked = (rowId, columnId, column) =>
    readOnly || Boolean(column.nonEditable) || locked.has(`${rowId}\u0000${columnId}`)

  // The rows are rebuilt only when what they show changes. Dash re-renders
  // the grid for every property it sets, such as the selection on a click;
  // handing ReactGrid new rows then can drop keys typed into a cell.
  const rows = useMemo(() => {
    const columnsStyle = columns.map((column) => ({ ...alignToStyle(column.align), ...column.style }))
    /** A row's cells, with columns whose rules fail locked and marked. */
    const createRow = (rowId, values, ruleValues = values) => ({
      rowId,
      cells: columns.map((column, col) => {
        const applies = rulesHold(column, ruleValues, allColumnIds)
        const cell = createCell(
          column,
          values[allColumnIds.indexOf(column.columnId)],
          columnsStyle[col],
          !applies || isLocked(rowId, column.columnId, column),
          openDropdown !== null && openDropdown.rowId === rowId && openDropdown.columnId === column.columnId,
        )
        return applies ? cell : { ...cell, className: `${cell.className || ''} rg-cell-na` }
      })
    })
    const headerRow = {
      rowId: "header",
      cells: columns.map((column) => ({
        type: "header",
        text: column.title,
        style: { ...styleHeader, ...column.headerStyle, ...alignToStyle(column.align) },
      })),
      height: styleHeader?.height
    }
    return [
      headerRow,
      ...table.data.map((values, idx) => createRow(table.rowIds[idx], values)),
      ...(extendable ? [createRow(GHOST_ROW_ID, blankRow(allColumns, null), blankRow(allColumns, newRow))] : []),
    ]
  }, [allColumns, columns, table, newRow, locked, readOnly, styleHeader, extendable, openDropdown])

  // ReactGrid fails when nothing is left to scroll, as when every column of
  // a one-column table is sticky, so at least one row and column scroll.
  const sticky = stickyCounts(props, columns.length, rows.length)

  /** Publish a new table and the edits that made it. */
  const publish = (next) => {
    if (next.edits.length === 0) return
    sequence.current += 1
    const update = { data: next.data, edits: { seq: sequence.current, edits: next.edits } }
    if (tracked) update.rowIds = next.rowIds
    setProps(update)
  }

  /** Apply value changes, remembering cell edits for undo. */
  const change = (changes, remember = true) => {
    const next = applyChanges(table, changes, { columns: allColumns, newRow })
    publish(next)
    if (next.edits.some((edit) => edit.kind !== "cell")) {
      // Undo restores values, not rows, so a new row starts a new history.
      setHistory(NO_HISTORY)
    } else if (remember && next.edits.length) {
      const step = next.edits.map((edit) => ({
        rowId: edit.rowId,
        columnId: edit.columnId,
        before: table.data[table.rowIds.indexOf(edit.rowId)][allColumnIds.indexOf(edit.columnId)] ?? null,
        after: edit.value,
      }))
      setHistory({ changes: [...history.changes.slice(0, history.index + 1), step], index: history.index + 1 })
    }
  }

  const handleChanges = (cellChanges) => {
    const changes = []
    cellChanges.forEach((cellChange) => {
      const column = columns[columnIds.indexOf(cellChange.columnId)]
      if (!column) return
      if (cellChange.newCell.type === 'dropdown') {
        const opened = cellChange.newCell.isOpen
        setOpenDropdown(opened ? { rowId: cellChange.rowId, columnId: cellChange.columnId } : null)
        if (cellChange.newCell.selectedValue === cellChange.previousCell.selectedValue) return
      }
      changes.push({ rowId: cellChange.rowId, columnId: cellChange.columnId, value: valueOf(column, cellChange.newCell) })
    })
    if (changes.length) change(changes)
  }

  const handleUndo = () => {
    if (history.index < 0) return
    const step = history.changes[history.index]
    change(step.map(({ rowId, columnId, before }) => ({ rowId, columnId, value: before })), false)
    setHistory({ ...history, index: history.index - 1 })
  }

  const handleRedo = () => {
    if (history.index + 1 >= history.changes.length) return
    const step = history.changes[history.index + 1]
    change(step.map(({ rowId, columnId, after }) => ({ rowId, columnId, value: after })), false)
    setHistory({ ...history, index: history.index + 1 })
  }

  /** The cells of the clipboard: ReactGrid's own markup, else Excel's text. */
  const clipboardCells = (clipboard) => {
    const html = clipboard.getData("text/html");
    const document = new DOMParser().parseFromString(html, "text/html");
    const root = document.body.firstElementChild
    if (root?.getAttribute("data-reactgrid") === "reactgrid-content" && root.firstElementChild) {
      return Array.from(root.firstElementChild.children).map((tableRow) =>
        Array.from(tableRow.children).map((td) => {
          const raw = td.getAttribute("data-reactgrid");
          return raw ? JSON.parse(raw) : { type: "text", text: td.innerHTML };
        }))
    }
    return clipboard.getData("text/plain")
      .replace(/\r?\n$/, '') // Excel ends its copy with a newline
      .split("\n")
      .map((line) => line.split("\t").map((text) => ({ type: "text", text: text.replace('\r', '') })))
  }

  const handlePaste = (e) => {
    e.stopPropagation()
    e.preventDefault()
    const ranges = selection.current
    if (readOnly || !ranges || !ranges.length) return
    const first = ranges[0].first
    const changes = []
    clipboardCells(e.clipboardData).forEach((cells, ri) => {
      const position = first.row.idx - 1 + ri // -1 for the header row
      let rowId
      if (position < table.data.length) {
        rowId = table.rowIds[position]
      } else if (extendable) {
        rowId = { ghost: position - table.data.length }
      } else {
        return
      }
      cells.forEach((cell, ci) => {
        const col = first.column.idx + ci
        if (col >= columns.length) return
        const column = columns[col]
        const values = typeof rowId === "object" ? blankRow(allColumns, newRow) : table.data[position]
        if (!rulesHold(column, values, allColumnIds)) return
        if (typeof rowId !== "object" && isLocked(rowId, column.columnId, column)) return
        changes.push({ rowId, columnId: column.columnId, value: pastedValue(column, cell, parsers) })
      })
    })
    if (changes.length) change(changes)
  }

  const handleCopy = (e) => {
    const ranges = selection.current
    if (!ranges || !ranges.length) return
    const range = ranges[0]
    const lines = []
    for (let row = range.first.row.idx; row <= range.last.row.idx; row++) {
      const cells = []
      for (let column = range.first.column.idx; column <= range.last.column.idx; column++) {
        cells.push(textOf(rows[row].cells[column]))
      }
      lines.push(cells.join("\t"))
    }
    e.clipboardData.setData("text/plain", lines.join("\n"))
    e.preventDefault()
  }

  const handleSelectionChanged = (ranges) => {
    selection.current = ranges
    setProps({ selectedRange: ranges, selectedRowIds: tracked ? rowsInRanges(ranges) : [] })
  }

  const handleContextMenu = (selectedRowIds, selectedColIds, selectionMode, menuOptions, selectedRanges) => {
    if (!tracked || readOnly) return menuOptions
    const removing = []
    selectedRanges.forEach((range) => range.forEach(({ rowId }) => {
      if (rowId !== "header" && rowId !== GHOST_ROW_ID && !removing.includes(rowId)) removing.push(rowId)
    }))
    if (!removing.length) return menuOptions
    return [
      ...menuOptions,
      {
        id: DELETE_ROWS_OPTION,
        label: removing.length === 1 ? "Delete row" : `Delete ${removing.length} rows`,
        handler: () => {
          publish(removeRows(table, removing))
          setHistory(NO_HISTORY)
        },
      },
    ]
  }

  // Caught before ReactGrid, which swallows the keys it handles itself.
  // While a cell is being typed in, its own input undoes the typing.
  const handleKeyDown = (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("rg-input") && e.target.type !== "checkbox") return
    if ((!isMacOs() && e.ctrlKey) || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "z":
          e.preventDefault();
          handleUndo();
          return;
        case "y":
          e.preventDefault();
          handleRedo();
          return;
      }
    }
  }

  // ReactGrid gets handlers that never change and call the latest ones, so
  // the element below changes only with what the grid shows.
  const latest = useRef(null)
  latest.current = {
    handleChanges,
    handleContextMenu,
    handleSelectionChanged,
    handleFocus: (location) => setProps({ selectedCell: location }),
  }
  const onCellsChanged = useCallback((changes) => latest.current.handleChanges(changes), [])
  const onContextMenu = useCallback((...args) => latest.current.handleContextMenu(...args), [])
  const onSelectionChanged = useCallback((ranges) => latest.current.handleSelectionChanged(ranges), [])
  const onFocusLocationChanged = useCallback((location) => latest.current.handleFocus(location), [])

  const { enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling } = props
  const grid = useMemo(() => (
    <ReactGrid rows={rows} columns={columns} onCellsChanged={onCellsChanged}
      onFocusLocationChanged={onFocusLocationChanged}
      enableFillHandle={enableFillHandle && !readOnly}
      enableRangeSelection={enableRangeSelection}
      enableRowSelection={enableRowSelection}
      enableColumnSelection={enableColumnSelection}
      onContextMenu={onContextMenu} highlights={highlights}
      stickyLeftColumns={sticky.left}
      stickyRightColumns={sticky.right}
      stickyTopRows={sticky.top}
      stickyBottomRows={sticky.bottom}
      customCellTemplates={customCellTemplates}
      onSelectionChanged={onSelectionChanged}
      disableVirtualScrolling={disableVirtualScrolling}
    />
  ), [rows, columns, readOnly, highlights, sticky.left, sticky.right, sticky.top, sticky.bottom,
    enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling])

  return (
    <div onPasteCapture={handlePaste} onCopy={handleCopy} onKeyDownCapture={handleKeyDown}>
      {grid}
    </div>
  )
}

DashReactGrid.defaultProps = {
  enableFillHandle: true, enableRangeSelection: true, enableRowSelection: true, enableColumnSelection: true,
  stickyLeftColumns: 0,
  stickyRightColumns: 0,
  stickyTopRows: 0,
  stickyBottomRows: 0,
  highlights: null,
  isExtendable: false,
  readOnly: false,
  className: null,
  disableVirtualScrolling: true,
  persistence_type: 'local',
  persisted_props: ['columns', 'data'],
};

DashReactGrid.propTypes = {
  /**
   * The ID used to identify this component in Dash callbacks.
   */
  id: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),

  /**
   * The columns: `columnId`, `title`, `type` (text, number, percent,
   * dropdown, checkbox, date or time), and optionally `width`, `align`,
   * `style`, `headerStyle`, `formatOptions` (Intl.NumberFormat options),
   * `values` (a dropdown's options), `nonEditable`, `className` (every cell
   * also has `rg-col-<columnId>`) and
   * `editableWhen` (rules on the row's other values, see `rulesHold`; a
   * cell whose rules fail is locked and has the class `rg-cell-na`).
   */
  columns: PropTypes.any.isRequired,

  /**
   * The rows, each an array of values in column order.
   */
  data: PropTypes.any.isRequired,

  /**
   * An id per row of `data`. Given, edits name rows by these ids, rows the
   * user adds get ids starting `new-`, and rows can be deleted from the
   * context menu. Omitted, rows are named by position.
   */
  rowIds: PropTypes.array,

  /**
   * The values a row the user adds starts with: an array in column order, or
   * an object by column id. Blank if omitted.
   */
  newRow: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),

  /**
   * Cells the user cannot edit, as `[rowId, columnId]` pairs.
   */
  lockedCells: PropTypes.array,

  /**
   * Whether every cell is locked, no row can be added and none deleted.
   */
  readOnly: PropTypes.bool,

  /**
   * The ids of columns not to show; their values stay in `data`.
   */
  hiddenColumns: PropTypes.array,

  /**
   * The edits behind the latest change to `data` (read only): `seq`, which
   * increases with every change, and `edits`, each one of
   * `{kind: "cell", rowId, columnId, value}`, `{kind: "add", rowId}` or
   * `{kind: "remove", rowIds}`.
   */
  edits: PropTypes.object,

  /**
   * The ids of the rows the selection covers (read only).
   */
  selectedRowIds: PropTypes.array,

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
  selectedRange: PropTypes.any,
  /**
   * Whether the table shows a blank row after its data, which becomes a new
   * row once the user types or pastes into it.
   */
  isExtendable: PropTypes.bool,
  /**
   * The style of the container (div)
   */
  style: PropTypes.object,
  styleHeader: PropTypes.object,
  className: PropTypes.string,
  disableVirtualScrolling: PropTypes.bool,
  persistence: PropTypes.oneOfType(
    [PropTypes.bool, PropTypes.string, PropTypes.number]
  ),
  persistence_type: PropTypes.oneOf(['local', 'session', 'memory']),
  persisted_props: PropTypes.arrayOf(PropTypes.oneOf(['columns', 'data'])),
  /**
   * Dash-assigned callback that should be called to report property changes
   * to Dash, to make them available for callbacks.
   */
  setProps: PropTypes.func
};

export default DashReactGrid;
