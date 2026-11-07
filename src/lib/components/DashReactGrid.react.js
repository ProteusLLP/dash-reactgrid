import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css"
import { CustomNumberCellTemplate, numberParser } from '../CustomNumberCell';
import { PercentCellTemplate, percentParser } from '../PercentCell';
import { PortalDropdownCellTemplate } from '../PortalDropdownCell';
import { compileGridColumns, buildGridRows, pageBounds, canPasteOnPage } from '../gridRows';
import {
  GHOST_ROW_ID,
  applyChanges,
  blankRow,
  columnClass,
  optionsOf,
  pastedValue,
  removeRows,
  rowIdsOf,
  rowIndexesOf,
  rowsInRanges,
  rulesHold,
  stickyCounts,
  textOf,
  valueOf,
} from '../model';
import { clearSelectedCells, focusedRange, isCellEditorTarget, pasteStartRow, selectAllRanges, selectionText } from '../keyboard';

const locale = window.navigator.language
const parsers = { number: numberParser, percent: percentParser }
const customCellTemplates = { 'percent': new PercentCellTemplate(), 'customnumber': new CustomNumberCellTemplate() }
// With dropdownMenuPortal, dropdown menus render on the page body instead of
// inside their cell, so clipping or scrolling ancestors cannot cut them off.
const portalCellTemplates = { ...customCellTemplates, 'dropdown': new PortalDropdownCellTemplate() }
const DELETE_ROWS_OPTION = "deleteRows"
const NO_HISTORY = { changes: [], index: -1 }

const isMacOs = () => window.navigator.appVersion.indexOf("Mac") !== -1;

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
  const displayedColumnIndex = useMemo(
    () => new Map(columnIds.map((id, idx) => [id, idx])), [columns],
  )
  const allColumnIndex = useMemo(
    () => new Map(allColumnIds.map((id, idx) => [id, idx])), [allColumns],
  )
  const [requestedPage, setRequestedPage] = useState(0)
  const [pageInput, setPageInput] = useState("1")
  const pageSize = Number.isInteger(props.rowPageSize) && props.rowPageSize > 0 ? props.rowPageSize : null
  const bounds = pageBounds(table.data.length, pageSize, requestedPage)
  const { page, count: pageCount, start: pageStart, end: pageEnd } = bounds
  useEffect(() => {
    if (requestedPage !== page) {
      setRequestedPage(page)
      setPageInput(String(page + 1))
    }
  }, [requestedPage, page])
  const showGhost = extendable && (!pageSize || page === pageCount - 1)
  const renderColumns = useMemo(() => compileGridColumns(columns, allColumns, locale), [columns, allColumns])
  const rowCache = useRef(null)

  const [openDropdown, setOpenDropdown] = useState(null)
  const [history, setHistory] = useState(NO_HISTORY)
  const selection = useRef(null)
  const focused = useRef(null)
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

  // Only pass the current page to ReactGrid: its cell-matrix builder touches
  // every cell, even when it has virtual DOM scrolling enabled.
  const rows = useMemo(() => {
    const validCache = rowCache.current &&
      rowCache.current.descriptors === renderColumns &&
      rowCache.current.locked === locked &&
      rowCache.current.readOnly === readOnly &&
      rowCache.current.newRow === newRow &&
      rowCache.current.styleHeader === styleHeader;
    const built = buildGridRows({
      columns, descriptors: renderColumns, allColumns,
      data: table.data.slice(pageStart, pageEnd),
      rowIds: table.rowIds.slice(pageStart, pageEnd),
      newRow, readOnly, locked, styleHeader, showGhost, openDropdown,
      previous: validCache ? rowCache.current.cache : null,
    });
    rowCache.current = {
      descriptors: renderColumns, locked, readOnly, newRow, styleHeader,
      cache: built.cache,
    };
    return built.rows;
  }, [columns, renderColumns, allColumns, table, pageStart, pageEnd,
    newRow, locked, readOnly, styleHeader, showGhost, openDropdown]);

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
    if (pageSize && next.edits.some((edit) => edit.kind === "add") &&
        next.data.length > (page + 1) * pageSize) {
      const last = Math.floor((next.data.length - 1) / pageSize)
      setRequestedPage(last)
      setPageInput(String(last + 1))
      selection.current = null
      focused.current = null
    }
    if (next.edits.some((edit) => edit.kind !== "cell")) {
      // Undo restores values, not rows, so a new row starts a new history.
      setHistory(NO_HISTORY)
    } else if (remember && next.edits.length) {
      const rowIndex = rowIndexesOf(table.rowIds)
      const step = next.edits.map((edit) => ({
        rowId: edit.rowId,
        columnId: edit.columnId,
        before: table.data[rowIndex.get(edit.rowId)][allColumnIndex.get(edit.columnId)] ?? null,
        after: edit.value,
      }))
      setHistory({ changes: [...history.changes.slice(0, history.index + 1), step], index: history.index + 1 })
    }
  }

  const handleChanges = (cellChanges) => {
    const changes = []
    cellChanges.forEach((cellChange) => {
      const column = columns[displayedColumnIndex.get(cellChange.columnId)]
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
    if (isCellEditorTarget(e.target)) return
    e.stopPropagation()
    e.preventDefault()
    const ranges = selection.current
    if (readOnly || !ranges || !ranges.length) return
    const first = ranges[0].first
    const changes = []
    clipboardCells(e.clipboardData).forEach((cells, ri) => {
      const position = pageStart + pasteStartRow(ranges[0]) + ri // the header is not a data row
      // Do not silently modify data on a page the user cannot see.
      if (!canPasteOnPage(position, bounds, pageSize)) return
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
    if (isCellEditorTarget(e.target)) return
    const text = selectionText(rows, selection.current, textOf)
    if (text === null) return
    e.clipboardData.setData("text/plain", text)
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
    if (isCellEditorTarget(e.target)) return
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
      // Handle clearing here instead of relying on ReactGrid's last-row
      // behaviour. The blank extension row is never a data edit.
      const ranges = selection.current?.length ? selection.current :
        [focusedRange(rows, columns, focused.current)].filter(Boolean)
      const changes = readOnly ? [] : clearSelectedCells(rows, columns, ranges)
      if (changes.length) {
        e.preventDefault()
        e.stopPropagation()
        change(changes)
      }
      return
    }
    if ((!isMacOs() && e.ctrlKey) || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "a":
          if (!e.shiftKey && !e.altKey) {
            // ReactGrid selects the entire matrix without notifying onSelectionChanged.
            // Keep our clipboard selection and Dash's selectedRange in sync.
            const ranges = selectAllRanges(selection.current, rows, columns, focused.current)
            if (ranges) handleSelectionChanged(ranges)
          }
          return; // let ReactGrid update its own selection and highlight
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
    handleFocus: (location) => {
      focused.current = location
      setProps({ selectedCell: location })
    },
  }
  const onCellsChanged = useCallback((changes) => latest.current.handleChanges(changes), [])
  const onContextMenu = useCallback((...args) => latest.current.handleContextMenu(...args), [])
  const onSelectionChanged = useCallback((ranges) => latest.current.handleSelectionChanged(ranges), [])
  const onFocusLocationChanged = useCallback((location) => latest.current.handleFocus(location), [])

  const { enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling, dropdownMenuPortal } = props
  const grid = useMemo(() => (
    <ReactGrid key={pageSize ? `page-${page}` : 'all'} rows={rows} columns={columns} onCellsChanged={onCellsChanged}
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
      customCellTemplates={dropdownMenuPortal ? portalCellTemplates : customCellTemplates}
      onSelectionChanged={onSelectionChanged}
      disableVirtualScrolling={disableVirtualScrolling}
    />
  ), [rows, columns, readOnly, highlights, sticky.left, sticky.right, sticky.top, sticky.bottom,
    enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling,
    dropdownMenuPortal, pageSize, page])

  const goToPage = (requested) => {
    if (!Number.isFinite(requested)) {
      setPageInput(String(page + 1))
      return
    }
    const next = pageBounds(table.data.length, pageSize, Math.trunc(requested)).page
    setRequestedPage(next)
    setPageInput(String(next + 1))
    selection.current = null
    focused.current = null
    setProps({ selectedRange: [], selectedRowIds: [], selectedCell: null })
  }

  return (
    <div onPasteCapture={handlePaste} onCopy={handleCopy} onKeyDownCapture={handleKeyDown}>
      {grid}
      {pageSize && pageCount > 1 && (
        <nav className="drg-pager" aria-label="Grid pages">
          <button type="button" disabled={page === 0} onClick={() => goToPage(page - 1)}>Previous</button>
          <span>Rows {pageStart + 1}-{pageEnd} of {table.data.length}</span>
          <label>Page <input type="number" min="1" max={pageCount}
            aria-label="Grid page number" value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.stopPropagation()
                goToPage(Number(pageInput) - 1)
              }
            }}/></label>
          <button type="button" onClick={() => goToPage(Number(pageInput) - 1)}>Go</button>
          <span>of {pageCount}</span>
          <button type="button" disabled={page === pageCount - 1} onClick={() => goToPage(page + 1)}>Next</button>
        </nav>
      )}
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
  rowPageSize: null,
  dropdownMenuPortal: false,
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
   * cell whose rules fail is locked and has the class `rg-cell-na`). A cell
   * the user can edit has the class `rg-cell-editable`, tinted light blue;
   * set `--drg-editable-cell-color` to change the tint.
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
  /**
   * Optional maximum data rows shown on one page, e.g. 250. ReactGrid
   * creates a cell matrix for all supplied rows even with virtual scrolling.
   * Paging bounds that work for very large datasets; page selection and
   * clipboard operations refer only to the current page.
   * The whole data array is still transferred to Dash on edits.
   */
  rowPageSize: PropTypes.number,
  /**
   * Whether dropdown menus render in a portal on the page body, with fixed
   * positioning, rather than inside their cell. Turn it on when the grid sits
   * in something that clips or scrolls, such as a card or the grid's own
   * scroll area, so menus can extend past its edges and show above nearby
   * content. Off by default, which keeps ReactGrid's own dropdown.
   */
  dropdownMenuPortal: PropTypes.bool,
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
