import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css"
import { numberParser } from '../CustomNumberCell';
import { percentParser } from '../PercentCell';
import { createCellTemplates } from '../cellTemplates';
import { ServerVirtualGrid } from '../ServerVirtualGrid.react';
import { compileGridColumns, buildGridRows, pageBounds, canPasteOnPage, visibleGridColumns, resizeGridColumns } from '../gridRows';
import { useReliableGrid } from '../useReliableGrid';
import { decodeGridData } from '../numericData';
import {
  GHOST_ROW_ID,
  applyChanges,
  blankRow,
  columnClass,
  optionsOf,
  pastedValue,
  removeRows,
  rowIndexesOf,
  rowsInRanges,
  rulesHold,
  stickyCounts,
  textOf,
  valueOf,
} from '../model';
import { clearSelectedCells, focusedRange, isCellEditorTarget, pasteStartRow, selectAllRanges, selectionText } from '../keyboard';
import { parseClipboardTsv } from '../virtualOperations';
import {
  sheetEdge, keyboardRectangle, keyboardArea, nativeRectangle,
  publicKeyboardRange, keyboardHighlights, fillDownChanges,
  multiEditChanges, keyboardClipboardText, MAX_KEYBOARD_EDIT_CELLS,
} from '../spreadsheetKeyboard';

const locale = window.navigator.language
const parsers = { number: numberParser, percent: percentParser }
const DELETE_ROWS_OPTION = "deleteRows"
const NO_HISTORY = { changes: [], index: -1 }

const isMacOs = () => window.navigator.appVersion.indexOf("Mac") !== -1;

const DashReactGrid = props => {
  const { id, style, className } = props;
  // ReactGrid ignores a class name, so it goes on the container.
  return (
    <div id={typeof id === 'object' ? JSON.stringify(id) : id} style={style} className={className || undefined}>
      {Number.isSafeInteger(props.virtualRowCount) && props.virtualRowCount >= 0
        ? <ServerVirtualGrid {...props} />
        : <ReactGridDataHandler {...props} />}
    </div>
  );
}

const ReactGridDataHandler = (props) => {
  const { columns: allColumns, data: sourceData, rowIds, newRow, lockedCells, readOnly, hiddenColumns, styleHeader, isExtendable, highlights, setProps } = props;
  const data = useMemo(() => decodeGridData(sourceData), [sourceData]);
  const cellTemplates = useMemo(() => createCellTemplates(Boolean(props.dropdownMenuPortal)), [props.dropdownMenuPortal]);

  // Hidden columns keep their place in `data`; the grid sees only the rest.
  const columns = useMemo(() =>
    visibleGridColumns(allColumns, hiddenColumns), [allColumns, hiddenColumns])
  const allColumnIds = allColumns.map((column) => column.columnId)

  const tracked = Array.isArray(rowIds)
  const transmitSparseEdits = Boolean(props.transmitSparseEdits)
  const sync = useReliableGrid({
    enabled: transmitSparseEdits, id: props.id,
    datasetId: props.editDatasetId, editAck: props.editAck,
    data, rowIds, columns: allColumns, newRow, setProps,
  })
  const { table, tableRef } = sync
  const editingBlocked = readOnly || Boolean(sync.error)
  const extendable = isExtendable && !editingBlocked
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
  const shortcutRange = useRef(null)
  const shortcutAnchor = useRef(null)
  const shortcutCursor = useRef(null)
  const suppressNativeSelection = useRef(false)
  const [shortcutHighlight, setShortcutHighlight] = useState(null)
  const [jumpLocation, setJumpLocation] = useState(null)
  const keyboardHost = useRef(null)
  const [keyboardError, setKeyboardError] = useState(null)
  const multiCommit = useRef(false)
  const lastMultiSelection = useRef(null)

  // The server sends new columns only when it remounts the table, which
  // starts a new history; the grid's own changes never touch them.
  const columnSchema = useMemo(() => JSON.stringify(allColumns.map(
    ({width, ...metadata}) => metadata
  )), [allColumns])
  useEffect(() => setHistory(NO_HISTORY), [columnSchema])
  // An authoritative server replacement invalidates local undo history.
  // In normal mode, data changes on every edit and must NOT reset history.
  useEffect(() => {
    if (transmitSparseEdits) setHistory(NO_HISTORY)
  }, [data, rowIds, transmitSparseEdits])

  const locked = useMemo(
    () => new Set((lockedCells || []).map(([rowId, columnId]) => `${rowId}\u0000${columnId}`)),
    [lockedCells],
  )
  const isLocked = (rowId, columnId, column) =>
    editingBlocked || Boolean(column.nonEditable) || locked.has(`${rowId}\u0000${columnId}`)

  // Only pass the current page to ReactGrid: its cell-matrix builder touches
  // every cell, even when it has virtual DOM scrolling enabled.
  const rows = useMemo(() => {
    const validCache = rowCache.current &&
      rowCache.current.descriptors === renderColumns &&
      rowCache.current.locked === locked &&
      rowCache.current.readOnly === editingBlocked &&
      rowCache.current.newRow === newRow &&
      rowCache.current.styleHeader === styleHeader;
    const built = buildGridRows({
      columns, descriptors: renderColumns, allColumns,
      data: table.data.slice(pageStart, pageEnd),
      rowIds: table.rowIds.slice(pageStart, pageEnd),
      newRow, readOnly: editingBlocked, locked, styleHeader, showGhost, openDropdown,
      previous: validCache ? rowCache.current.cache : null,
    });
    rowCache.current = {
      descriptors: renderColumns, locked, readOnly: editingBlocked, newRow, styleHeader,
      cache: built.cache,
    };
    return built.rows;
  }, [columns, renderColumns, allColumns, table, pageStart, pageEnd,
    newRow, locked, editingBlocked, styleHeader, showGhost, openDropdown]);

  // Highlights may reference rows on other pages. Passing them directly
  // makes ReactGrid reject them as inconsistent with its current cell matrix.
  const pageHighlights = useMemo(() => {
    const ids = new Set(rows.map((row) => row.rowId))
    const visible = new Set(columnIds)
    const supplied = (highlights || []).filter((highlight) =>
      ids.has(highlight.rowId) && visible.has(highlight.columnId))
    const selected = keyboardHighlights(shortcutHighlight, table.rowIds,
      columns, pageStart, pageEnd)
    return [...supplied, ...selected]
  }, [highlights, pageStart, pageEnd, rows, columns, shortcutHighlight, table.rowIds])

  // ReactGrid fails when nothing is left to scroll, as when every column of
  // a one-column table is sticky, so at least one row and column scroll.
  const sticky = stickyCounts(props, columns.length, rows.length)

  /** Commit a batch only if it was persisted to the reliable outbox. */
  const publish = (next) => sync.publish(next, tracked)

  const canEdit = (rowId, column, values) =>
    !isLocked(rowId, column.columnId, column) &&
    rulesHold(column, values, allColumnIds)

  /** Apply value changes, remembering cell edits for undo. */
  const change = (changes, remember = true) => {
    if (editingBlocked) return
    const currentTable = tableRef.current
    const rowIndexes = rowIndexesOf(currentTable.rowIds)
    const allowed = changes.filter(({rowId, columnId}) => {
      const index = allColumnIndex.get(columnId)
      if (index === undefined) return false
      const values = rowId === GHOST_ROW_ID ||
        (rowId && typeof rowId === "object")
        ? blankRow(allColumns, newRow)
        : currentTable.data[rowIndexes.get(rowId)]
      return values && canEdit(
        rowId && typeof rowId === "object" ? GHOST_ROW_ID : rowId,
        allColumns[index], values)
    })
    if (!allowed.length) return
    const next = applyChanges(currentTable, allowed, { columns: allColumns, newRow })
    if (!publish(next)) return
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
      const rowIndex = rowIndexesOf(currentTable.rowIds)
      const step = next.edits.map((edit) => ({
        rowId: edit.rowId,
        columnId: edit.columnId,
        before: currentTable.data[rowIndex.get(edit.rowId)][allColumnIndex.get(edit.columnId)] ?? null,
        after: edit.value,
      }))
      setHistory({ changes: [...history.changes.slice(0, history.index + 1), step], index: history.index + 1 })
    }
  }

  const handleChanges = (cellChanges) => {
    if (multiCommit.current && cellChanges.length === 1) {
      multiCommit.current = false
      const changed = cellChanges[0]
      const source = columns[displayedColumnIndex.get(changed.columnId)]
      const sourceRow = rowIndexesOf(table.rowIds).get(changed.rowId)
      const rect = shortcutRange.current ||
        lastMultiSelection.current ||
        nativeRectangle(selection.current, pageStart, table.data.length,
          columns.length)
      if (source && rect && sourceRow >= rect.start && sourceRow < rect.end &&
          keyboardArea(rect) > 1) {
        try {
          const changes = multiEditChanges(rect, changed, source,
            (row) => row < table.data.length
              ? {rowId:table.rowIds[row],values:table.data[row]} : null,
            columns, canEdit, parsers)
          if (changes?.length) change(changes)
          setKeyboardError(null)
          return
        } catch (error) {
          setKeyboardError(error.message)
          return
        }
      }
    }
    multiCommit.current = false
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
    return parseClipboardTsv(clipboard.getData("text/plain"))
      .map((line) => line.map((text) => ({ type: "text", text })))
  }

  const handlePaste = (e) => {
    if (isCellEditorTarget(e.target)) return
    e.stopPropagation()
    e.preventDefault()
    const ranges = selection.current
    const keyRange = shortcutRange.current
    if (editingBlocked || (!keyRange && (!ranges || !ranges.length))) return
    const first = keyRange ? null : ranges[0].first
    const changes = []
    clipboardCells(e.clipboardData).forEach((cells, ri) => {
      const position = (keyRange ? keyRange.start :
        pageStart + pasteStartRow(ranges[0])) + ri // the header is not a data row
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
        const col = (keyRange ? keyRange.columnStart : first.column.idx) + ci
        if (col >= columns.length) return
        const column = columns[col]
        const values = typeof rowId === "object" ? blankRow(allColumns, newRow) : table.data[position]
        if (!rulesHold(column, values, allColumnIds)) return
        if (isLocked(typeof rowId === "object" ? GHOST_ROW_ID : rowId, column.columnId, column)) return
        changes.push({ rowId, columnId: column.columnId, value: pastedValue(column, cell, parsers) })
      })
    })
    if (changes.length) change(changes)
  }

  const handleCopy = (e) => {
    if (isCellEditorTarget(e.target)) return
    const text = shortcutRange.current
      ? keyboardClipboardText(shortcutRange.current,table.data,allColumns,columns)
      : selectionText(rows, selection.current, textOf)
    if (text === null) {
      if (shortcutRange.current) {
        e.preventDefault()
        e.stopPropagation()
        setKeyboardError("Copy is limited to 20,000 cells; use a smaller range or server export")
      }
      return
    }
    e.clipboardData.setData("text/plain", text)
    e.preventDefault()
  }

  const handleSelectionChanged = (ranges) => {
    if (suppressNativeSelection.current) return
    selection.current = ranges
    shortcutRange.current = null
    setShortcutHighlight(null)
    const rect = nativeRectangle(ranges,pageStart,table.data.length,columns.length)
    lastMultiSelection.current = keyboardArea(rect)>1 ? rect : null
    setProps({ selectedRange: ranges, selectedRowIds: tracked ? rowsInRanges(ranges) : [] })
  }

  const focusedPosition = () => {
    if (!focused.current) return null
    const row = rowIndexesOf(table.rowIds).get(focused.current.rowId)
    const col = displayedColumnIndex.get(focused.current.columnId)
    if (col === undefined) return null
    if (row === undefined) return null
    return {row,col}
  }

  const navigateToEdge = (key,shift) => {
    const current = shortcutCursor.current || focusedPosition()
    const target = sheetEdge(key,current,table.data.length,columns.length)
    if (!target) return
    if (shift) {
      const anchor = shortcutAnchor.current || focusedPosition() || current
      const rect = keyboardRectangle(anchor,target)
      shortcutAnchor.current = anchor
      shortcutCursor.current = target
      shortcutRange.current = rect
      setShortcutHighlight(rect)
      suppressNativeSelection.current = true
      setProps({
        selectedRange:[publicKeyboardRange(rect,table.rowIds,columns)],
        selectedRowIds:tracked && rect.end-rect.start<=1000
          ? table.rowIds.slice(rect.start,rect.end) : [],
      })
    } else {
      shortcutAnchor.current = target
      shortcutCursor.current = target
      shortcutRange.current = null
      lastMultiSelection.current = null
      setShortcutHighlight(null)
      suppressNativeSelection.current = true
      const location={rowId:table.rowIds[target.row],
        columnId:columns[target.col].columnId}
      focused.current=location
      setJumpLocation(location)
      setProps({selectedCell:location,selectedRange:[],selectedRowIds:[]})
      if (pageSize) {
        const destination=Math.floor(target.row/pageSize)
        if (destination !== page) {
          setRequestedPage(destination)
          setPageInput(String(destination+1))
        }
      }
    }
    setKeyboardError(null)
  }

  const activeRectangle = () =>
    shortcutRange.current || nativeRectangle(selection.current,pageStart,
      table.data.length,columns.length,focusedPosition())

  const fillDown = () => {
    if (editingBlocked) return
    try {
      const changes=fillDownChanges(activeRectangle(),table.data,table.rowIds,
        allColumns,columns,canEdit)
      if (changes.length) change(changes)
      setKeyboardError(null)
    } catch(error) {
      setKeyboardError(error.message)
    }
  }

  const handleContextMenu = (selectedRowIds, selectedColIds, selectionMode, menuOptions, selectedRanges) => {
    if (!tracked || editingBlocked) return menuOptions
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
          if (publish(removeRows(tableRef.current, removing))) setHistory(NO_HISTORY)
        },
      },
    ]
  }

  // Caught before ReactGrid, which swallows the keys it handles itself.
  // While a cell is being typed in, its own input undoes the typing.
  const handleKeyDown = (e) => {
    if (isCellEditorTarget(e.target)) {
      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey &&
          !e.altKey) multiCommit.current = true
      return
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey &&
        ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab","Enter"].includes(e.key)) {
      suppressNativeSelection.current = false
      shortcutAnchor.current = null
      shortcutCursor.current = null
      shortcutRange.current = null
      setShortcutHighlight(null)
      setJumpLocation(null)
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
      // Handle clearing here instead of relying on ReactGrid's last-row
      // behaviour. The blank extension row is never a data edit.
      if (shortcutRange.current) {
        e.preventDefault()
        e.stopPropagation()
        const rect=shortcutRange.current
        if (editingBlocked) return
        if (keyboardArea(rect)>MAX_KEYBOARD_EDIT_CELLS) {
          setKeyboardError("Clear is limited to 20,000 cells per operation")
          return
        }
        const changes=[]
        for (let ri=rect.start;ri<rect.end;ri++) {
          const rowId=table.rowIds[ri]
          for (let ci=rect.columnStart;ci<rect.columnEnd;ci++) {
            const col=columns[ci]
            if (!canEdit(rowId,col,table.data[ri])) continue
            const value=col.type==="checkbox" ? false :
              ["text"].includes(col.type) ? "" : null
            changes.push({rowId,columnId:col.columnId,value})
          }
        }
        if (changes.length) change(changes)
        setKeyboardError(null)
        return
      }
      const ranges = selection.current?.length ? selection.current :
        [focusedRange(rows, columns, focused.current)].filter(Boolean)
      const changes = editingBlocked ? [] : clearSelectedCells(rows, columns, ranges)
      if (changes.length) {
        e.preventDefault()
        e.stopPropagation()
        change(changes)
      }
      return
    }
    if (((!isMacOs() && e.ctrlKey) || e.metaKey) && !e.altKey) {
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        navigateToEdge(e.key,e.shiftKey)
        return
      }
      switch (e.key.toLowerCase()) {
        case "d":
          if (!e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            fillDown()
          }
          return;
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
    resizeColumn: (columnId, width, selectedColIds) => {
      const next = resizeGridColumns(allColumns, columnId, width, selectedColIds)
      if (next.some((column, index) => column !== allColumns[index]))
        setProps({columns: next})
    },
    handleFocus: (location) => {
      focused.current = location
      setProps({ selectedCell: location })
    },
  }
  const onCellsChanged = useCallback((changes) => latest.current.handleChanges(changes), [])
  const onContextMenu = useCallback((...args) => latest.current.handleContextMenu(...args), [])
  const onSelectionChanged = useCallback((ranges) => latest.current.handleSelectionChanged(ranges), [])
  const onColumnResized = useCallback((...args) => latest.current.resizeColumn(...args), [])
  const onFocusLocationChanged = useCallback((location) => latest.current.handleFocus(location), [])

  // Switching pages remounts ReactGrid. focusLocation selects the target
  // logically, but browser keystrokes still need its hidden focus input.
  useEffect(() => {
    if (!jumpLocation || !rows.some((row) => row.rowId === jumpLocation.rowId))
      return
    keyboardHost.current?.querySelector("input.rg-hidden-element")
      ?.focus({preventScroll:true})
  }, [jumpLocation, page, rows])

  const { enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling, dropdownMenuPortal } = props
  const visibleJump = jumpLocation && rows.some((row) => row.rowId === jumpLocation.rowId)
    ? jumpLocation : undefined
  const grid = useMemo(() => (
    <ReactGrid key={pageSize ? `page-${page}` : 'all'} rows={rows} columns={columns} onCellsChanged={onCellsChanged}
      onFocusLocationChanged={onFocusLocationChanged}
      focusLocation={visibleJump}
      onColumnResized={onColumnResized}
      enableFillHandle={enableFillHandle && !editingBlocked}
      enableRangeSelection={enableRangeSelection}
      enableRowSelection={enableRowSelection}
      enableColumnSelection={enableColumnSelection}
      onContextMenu={onContextMenu} highlights={pageHighlights}
      stickyLeftColumns={sticky.left}
      stickyRightColumns={sticky.right}
      stickyTopRows={sticky.top}
      stickyBottomRows={sticky.bottom}
      customCellTemplates={cellTemplates}
      onSelectionChanged={onSelectionChanged}
      disableVirtualScrolling={disableVirtualScrolling}
    />
  ), [rows, columns, editingBlocked, pageHighlights, sticky.left, sticky.right, sticky.top, sticky.bottom,
    enableFillHandle, enableRangeSelection, enableRowSelection, enableColumnSelection, disableVirtualScrolling,
    dropdownMenuPortal, cellTemplates, pageSize, page, visibleJump])

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
    shortcutRange.current = null
    shortcutAnchor.current = null
    shortcutCursor.current = null
    suppressNativeSelection.current = false
    setShortcutHighlight(null)
    setJumpLocation(null)
    setProps({ selectedRange: [], selectedRowIds: [], selectedCell: null })
  }

  return (
    <div ref={keyboardHost} onPasteCapture={handlePaste} onCopy={handleCopy}
      onPointerDownCapture={() => {
        suppressNativeSelection.current=false
        shortcutRange.current=null
        shortcutAnchor.current=null
        shortcutCursor.current=null
        setShortcutHighlight(null)
        setJumpLocation(null)
      }}
      onKeyDownCapture={handleKeyDown}>
      {grid}
      {keyboardError && <div role="alert" className="drg-keyboard-error">{keyboardError}</div>}
      {transmitSparseEdits && (
        <div className="drg-sync-status" role="status" aria-live="polite">
          {sync.error ? (
            <>
              <span className="drg-sync-error">{sync.error}. {sync.pending} pending batch(es) retained.</span>
              {sync.pending > 0 && <button type="button" onClick={sync.retryFailed}>Retry sending</button>}
            </>
          ) : sync.pending > 0 ? (
            <span>{sync.pending} unacknowledged edit batch(es); retrying automatically</span>
          ) : (
            <span>All edits acknowledged</span>
          )}
        </div>
      )}
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
  virtualRowCount: null,
  virtualDatasetId: null,
  virtualRowHeight: 25,
  virtualWindowSize: 120,
  virtualViewportHeight: 420,
  virtualRequest: null,
  virtualData: null,
  virtualRangeRequest: null,
  virtualRangeData: null,
  virtualSelection: null,
  virtualExportUrl: null,
  transmitSparseEdits: false,
  editDatasetId: null,
  editAck: null,
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
   * `style`, `headerStyle`, `tooltip` (hover text for the header),
   * `formatOptions` (Intl.NumberFormat options),
   * `values` (a dropdown's options), `resizable` (true by default),
   * `nonEditable`, `className` (every cell
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
   * Server-backed continuous virtualization: provide the total number of
   * logical rows; set data=[] and omit rowIds. The client requests bounded
   * row windows through virtualRequest and receives them in virtualData.
   * Supplying a nonnegative integer enables virtual mode instead of paging.
   */
  virtualRowCount: PropTypes.number,
  /**
   * Stable identifier of the ordered server dataset. Change it when the
   * sort, filter, contents or revision changes to invalidate cached windows.
   */
  virtualDatasetId: PropTypes.string,
  /** Fixed height in pixels of each data row, default 25. */
  virtualRowHeight: PropTypes.number,
  /** Approximate number of rows fetched per request, default 120. */
  virtualWindowSize: PropTypes.number,
  /** Height in pixels of the scrollable viewport, default 420. */
  virtualViewportHeight: PropTypes.number,
  /**
   * Read-only row request {datasetId, requestId, start, end}. Start inclusive,
   * end exclusive. Return exactly end-start rows from the backend.
   */
  virtualRequest: PropTypes.object,
  /**
   * Server response {datasetId, requestId, start, rowIds, data} or
   * {datasetId, requestId, start, error}. Must echo the request identity.
   */
  virtualData: PropTypes.object,
  /**
   * Read-only request for preparing clipboard text across unloaded rows:
   * {datasetId,requestId,start,end,columnStart,columnEnd}.
   */
  virtualRangeRequest: PropTypes.object,
  /**
   * Server response echoing virtualRangeRequest and containing text or error.
   * Clipboards are limited to a bounded range; large selections use export.
   */
  virtualRangeData: PropTypes.object,
  /** Compact absolute-index selection, not an array of every selected row. */
  virtualSelection: PropTypes.object,
  /** Application-provided URL for authenticated streamed CSV exports. */
  virtualExportUrl: PropTypes.string,
  /**
   * When true, publish only {edits: {seq, edits}} through setProps.
   * The changed table is retained locally in the browser, including new
   * and deleted rows, and is replaced only by an external data/rowIds
   * update. Default false publishes full data as before.
   */
  transmitSparseEdits: PropTypes.bool,
  /**
   * Stable identifier for the authoritative dataset. Required in sparse mode
   * to recover pending batches across reloads without cross-dataset replay.
   */
  editDatasetId: PropTypes.string,
  /**
   * Authoritative server acknowledgement returned from a Dash callback:
   * {datasetId, streamId, seq, status: "ok" | "retry" | "error" | "conflict", message?}.
   * Only status "ok" removes the head batch from the durable outbox.
   */
  editAck: PropTypes.object,
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
