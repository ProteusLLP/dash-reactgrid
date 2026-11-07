import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactGrid } from "@silevis/reactgrid";
import { useReliableGrid } from "./useReliableGrid";
import { overlayVirtualEdits } from "./virtualOverlay";
import { compileGridColumns } from "./gridRows";
import {
  addViewportCache, buildVirtualRows, loadedRow, validViewportResponse,
  virtualRowWindow, viewportKey, VIRTUAL_LOADING_PREFIX,
  VIRTUAL_SPACER_TOP, VIRTUAL_SPACER_BOTTOM,
} from "./serverVirtual";
import {
  applyChanges, blankRow, newRowId, pastedValue, rowsInRanges, textOf, valueOf,
} from "./model";
import {
  clearSelectedCells, focusedRange, isCellEditorTarget,
  selectAllRanges, selectionText,
} from "./keyboard";
import {
  boundedSelection, extendSelection, copyRequestFor, matchesCopyResponse,
  makeRangePaste, historyStorageKey, initialHistory, loadHistory,
  saveHistory, nextHistory, MAX_RANGE_ROWS,
} from "./virtualOperations";
import { numberParser } from "./CustomNumberCell";
import { percentParser } from "./PercentCell";
import { CustomNumberCellTemplate } from "./CustomNumberCell";
import { PercentCellTemplate } from "./PercentCell";
import { PortalDropdownCellTemplate } from "./PortalDropdownCell";

const parsers = { number: numberParser, percent: percentParser };
const EMPTY_DATA = [];
const EMPTY_IDS = [];
const customCellTemplates = {
  customnumber: new CustomNumberCellTemplate(),
  percent: new PercentCellTemplate(),
};
const portalTemplates = { ...customCellTemplates,
  dropdown: new PortalDropdownCellTemplate() };
const isDataId = (id) => id !== "header" &&
  id !== VIRTUAL_SPACER_TOP && id !== VIRTUAL_SPACER_BOTTOM &&
  !String(id).startsWith(VIRTUAL_LOADING_PREFIX);

/**
 * Continuous, server-backed scrolling for large tables.
 *
 * ReactGrid sees a bounded set of rows plus two geometry spacer rows. Scroll
 * position belongs to the browser; Dash receives requests for absolute row
 * positions only when the requested window is not cached. Full data never
 * travels to or resides in this component.
 */
export const ServerVirtualGrid = (props) => {
  const {
    columns: allColumns, hiddenColumns, virtualRowCount: suppliedRowCount,
    virtualData, virtualRangeData,
    virtualDatasetId, virtualRowHeight = 25, virtualWindowSize = 120,
    virtualViewportHeight = 420, setProps, readOnly, lockedCells,
    styleHeader, highlights, dropdownMenuPortal,
  } = props;

  const viewportRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [virtualRowCount, setVirtualRowCount] = useState(suppliedRowCount);
  const [globalSelection, setGlobalSelection] = useState(null);
  const globalRef = useRef(null);
  const anchor = useRef(null);
  const shiftPointer = useRef(false);
  const [fromInput, setFromInput] = useState("1");
  const [toInput, setToInput] = useState("1");
  const [commandError, setCommandError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [copyText, setCopyText] = useState(null);
  const [copyError, setCopyError] = useState(null);
  const copyCounter = useRef(0);
  const copyPending = useRef(null);
  const lastAcknowledgedRevision = useRef(-1);
  const [cache, setCache] = useState(() => new Map());
  const [loadError, setLoadError] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const currentRequest = useRef(null);
  const requestCounter = useRef(0);
  const selection = useRef([]);
  const focused = useRef(null);

  const columns = useMemo(() => {
    const hidden = new Set(hiddenColumns || []);
    return allColumns.filter((column) => !hidden.has(column.columnId));
  }, [allColumns, hiddenColumns]);
  const descriptors = useMemo(() =>
    compileGridColumns(columns, allColumns, window.navigator.language),
    [columns, allColumns]);
  const columnById = useMemo(() =>
    new Map(columns.map((column) => [column.columnId, column])), [columns]);
  const locked = useMemo(() =>
    new Set((lockedCells || []).map(([r,c]) => String(r) + "\u0000" + String(c))),
    [lockedCells]);

  const valid = typeof virtualDatasetId === "string" && virtualDatasetId.trim() &&
    virtualRowCount >= 0 && Number.isSafeInteger(virtualRowCount) &&
    Number.isFinite(virtualRowHeight) && virtualRowHeight >= 16 &&
    Number.isSafeInteger(virtualWindowSize) && virtualWindowSize >= 20 &&
    Number.isFinite(virtualViewportHeight) && virtualViewportHeight > 0;

  const range = useMemo(() => valid ?
    virtualRowWindow(scrollTop, virtualRowCount, virtualRowHeight,
      virtualWindowSize, virtualViewportHeight) :
    {start:0,end:0,first:0,visible:0,totalHeight:0},
    [scrollTop, virtualRowCount, virtualRowHeight, virtualWindowSize,
      virtualViewportHeight, valid]);

  const key = viewportKey(virtualDatasetId, range.start, range.end);
  // In server mode the browser owns only a small window, so the durable
  // outbox is headless: pending edits are overlaid by row ID on each
  // server window instead of being replayed against a full table.
  const reliable = useReliableGrid({
    enabled: Boolean(props.transmitSparseEdits),
    id: props.id, datasetId: props.editDatasetId,
    editAck: props.editAck, data: EMPTY_DATA, rowIds: EMPTY_IDS,
    columns: allColumns, newRow: props.newRow, setProps, windowed: true,
  });
  // Inserting or deleting shifts row offsets; pause further editing until
  // the database commits and the viewport has been invalidated.
  const pendingStructure = Boolean(reliable.outbox?.queue.some((batch) =>
    batch.edits.some((edit) => !["cell", "paste"].includes(edit.kind))));
  const editingBlocked = readOnly || !props.transmitSparseEdits ||
    Boolean(reliable.error) || pendingStructure || Boolean(historyError);
  const cachedPage = cache.get(key);
  const page = useMemo(
    () => overlayVirtualEdits(cachedPage, reliable.outbox?.queue, allColumns),
    [cachedPage, reliable.outbox, allColumns],
  );
  const loading = valid && virtualRowCount > 0 && !cachedPage;

  useEffect(() => {
    setVirtualRowCount(suppliedRowCount);
    lastAcknowledgedRevision.current = -1;
  }, [suppliedRowCount, virtualDatasetId]);

  // ACKs from durable transactions carry authoritative row counts. Refresh
  // the viewport after every committed operation, preserving scroll offset.
  useEffect(() => {
    const ack = props.editAck;
    if (!ack || ack.status !== "ok" ||
        ack.datasetId !== props.editDatasetId ||
        !Number.isSafeInteger(ack.revision) ||
        ack.revision <= lastAcknowledgedRevision.current) return;
    lastAcknowledgedRevision.current = ack.revision;
    if (Number.isSafeInteger(ack.rowCount) && ack.rowCount >= 0)
      setVirtualRowCount(ack.rowCount);
    currentRequest.current = null;
    setCache(new Map());
    setLoadError(null);
  }, [props.editAck, props.editDatasetId]);

  // Invalidate old windows whenever the identity of the ordered server
  // dataset changes, such as a new sort, filter or revision.
  useEffect(() => {
    setCache(new Map());
    setLoadError(null);
    currentRequest.current = null;
    setScrollTop(0);
    selection.current = [];
    focused.current = null;
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [virtualDatasetId]);

  const requestWindow = useCallback((start, end) => {
    if (!valid || start === end) return;
    const request = {
      datasetId: virtualDatasetId,
      requestId: ++requestCounter.current,
      start, end,
    };
    currentRequest.current = request;
    setLoadError(null);
    setProps({virtualRequest: request});
  }, [valid, virtualDatasetId, setProps]);

  useEffect(() => {
    if (!loading || loadError) return;
    const outstanding = currentRequest.current;
    if (outstanding && outstanding.datasetId === virtualDatasetId &&
        outstanding.start === range.start && outstanding.end === range.end)
      return;
    requestWindow(range.start, range.end);
  }, [loading, loadError, range.start, range.end, virtualDatasetId, requestWindow]);

  useEffect(() => {
    const pending = currentRequest.current;
    if (!virtualData || !pending ||
        virtualData.requestId !== pending.requestId ||
        virtualData.datasetId !== pending.datasetId ||
        virtualData.start !== pending.start) return;
    if (virtualData.error) {
      setLoadError(String(virtualData.error));
      return;
    }
    if (!validViewportResponse(virtualData, pending, allColumns)) {
      setLoadError("The server returned invalid row IDs or an incorrectly sized window");
      return;
    }
    const responseKey = viewportKey(pending.datasetId, pending.start, pending.end);
    setCache((previous) => addViewportCache(previous, responseKey, virtualData));
    setLoadError(null);
  }, [virtualData, allColumns]);

  // Retry missing requests, including callbacks whose response was dropped.
  useEffect(() => {
    if (!loading || loadError) return;
    const timer = window.setInterval(() => {
      if (window.navigator.onLine !== false)
        requestWindow(range.start, range.end);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [loading, loadError, range.start, range.end, requestWindow]);

  // Changing only the focused cell must not rebuild ReactGrid rows during
  // a double-click: that would unmount its active cell editor.
  const visualSelection = globalSelection &&
    ((globalSelection.end - globalSelection.start) *
     (globalSelection.columnEnd - globalSelection.columnStart) > 1)
    ? globalSelection : null;

  const rows = useMemo(() => valid && columns.length && virtualRowCount > 0 ?
    buildVirtualRows({
      columns, descriptors, allColumns, rowCount:virtualRowCount, range,
      page, rowHeight:virtualRowHeight, readOnly:editingBlocked, locked,
      styleHeader, openDropdown, selection:visualSelection,
    }) : [],
    [valid, columns, descriptors, allColumns, virtualRowCount,
      range.start, range.end, page, virtualRowHeight, editingBlocked, locked,
      styleHeader, openDropdown, visualSelection]);

  const visibleHighlights = useMemo(() => {
    if (!highlights?.length || !page) return [];
    const visible = new Set(page.rowIds);
    const visibleColumns = new Set(columns.map((col) => col.columnId));
    return highlights.filter((mark) => visible.has(mark.rowId) &&
      visibleColumns.has(mark.columnId));
  }, [highlights, page, columns]);

  const undoKey = useMemo(
    () => historyStorageKey(props.id, props.editDatasetId),
    [props.id, props.editDatasetId],
  );
  const [history, setHistory] = useState(() => {
    try {
      return loadHistory(window.sessionStorage, undoKey,
        reliable.outbox?.streamId || "");
    } catch {
      return initialHistory(reliable.outbox?.streamId || "");
    }
  });
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    try {
      const restored = loadHistory(window.sessionStorage, undoKey,
        reliable.outbox?.streamId || "");
      historyRef.current = restored;
      setHistory(restored);
      setHistoryError(null);
    } catch (error) {
      setHistoryError("Cannot load the undo journal: " + error.message);
    }
  }, [undoKey, reliable.outbox?.streamId]);

  const remember = (kind, seq) => {
    if (!Number.isSafeInteger(seq)) return;
    try {
      const next = saveHistory(window.sessionStorage, undoKey,
        nextHistory(historyRef.current, kind, seq));
      historyRef.current = next;
      setHistory(next);
    } catch (error) {
      setHistoryError("Undo journal could not be saved: " + error.message);
    }
  };

  const submitOperation = (edits, kind = "edit") => {
    if (editingBlocked || !reliable.outbox) return null;
    const accepted = reliable.publish(
      { data: EMPTY_DATA, rowIds: EMPTY_IDS, edits }, true);
    if (!accepted) {
      setCommandError("The operation could not be safely queued");
      return null;
    }
    setCommandError(null);
    remember(kind, accepted.seq);
    return accepted;
  };

  const selectGlobal = (candidate) => {
    if (!candidate) return;
    globalRef.current = candidate;
    setGlobalSelection(candidate);
    setFromInput(String(candidate.start + 1));
    setToInput(String(candidate.end));
    setCopyText(null);
    setCopyError(null);
    copyPending.current=null;
  };

  const selectionAt = (rowId, colId) => {
    if (!page || !isDataId(rowId)) return null;
    const offset = page.rowIds.indexOf(rowId);
    const column = columns.findIndex((c) => c.columnId === colId);
    return offset < 0 || column < 0 ? null :
      { row: range.start + offset, col: column };
  };

  const applyRangeInputs = () => {
    const selection = boundedSelection(
      Number(fromInput) - 1, Number(toInput), 0, columns.length,
      virtualRowCount, columns.length,
    );
    if (!selection) {
      setCommandError("Enter a valid inclusive row range within the dataset");
      return;
    }
    setCommandError(null);
    selectGlobal(selection);
  };

  const insertRow = (append = false) => {
    const position = append ? virtualRowCount :
      (globalRef.current?.start ?? range.first);
    const id = "new-" + (window.crypto?.randomUUID?.() || newRowId());
    submitOperation([{
      kind: "insert", rowId: id, position,
      values: blankRow(allColumns, props.newRow),
    }]);
  };

  const deleteSelection = () => {
    const sel = globalRef.current;
    if (!sel || editingBlocked) return;
    const count = sel.end - sel.start;
    if (count > MAX_RANGE_ROWS) {
      setCommandError("Delete at most 1,000 rows in one operation");
      return;
    }
    if (window.confirm("Delete " + count + " selected row(s)?")) {
      submitOperation([{kind: "removeRange", start: sel.start, end: sel.end}]);
    }
  };

  const undoOperation = () => {
    const previous = historyRef.current.undo.at(-1);
    if (previous && !editingBlocked && !reliable.pending)
      submitOperation([{kind:"undo",targetSeq:previous}], "undo");
  };
  const redoOperation = () => {
    const previous = historyRef.current.redo.at(-1);
    if (previous && !editingBlocked && !reliable.pending)
      submitOperation([{kind:"undo",targetSeq:previous}], "redo");
  };

  // Publish global selections after ReactGrid finishes processing clicks.
  // Synchronous Dash prop updates on every focus can interrupt double-click
  // editing by replacing ReactGrid's active input.
  useEffect(() => {
    if (!globalSelection) return;
    const timer=window.setTimeout(
      () => setProps({virtualSelection:globalSelection}), 200);
    return () => window.clearTimeout(timer);
  }, [globalSelection, setProps]);

  // Prepare range data asynchronously via Dash, so the eventual Copy click
  // is a genuine user gesture and can use the synchronous clipboard event.
  useEffect(() => {
    setCopyText(null);
    setCopyError(null);
    copyPending.current=null;
    if (!globalSelection) return;
    // A click focusing a single cell is NOT a request to fetch its content.
    // In particular, don't trigger a Dash response during double-click edit.
    if ((globalSelection.end - globalSelection.start) *
        (globalSelection.columnEnd - globalSelection.columnStart) === 1) return;
    if (globalSelection.end - globalSelection.start > MAX_RANGE_ROWS) {
      setCopyError("Large selections must use Download CSV");
      return;
    }
    const timer = window.setTimeout(() => {
      const request = copyRequestFor(virtualDatasetId,
        ++copyCounter.current, globalSelection);
      copyPending.current = request;
      setProps({virtualRangeRequest:request});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [globalSelection, virtualDatasetId, props.editAck?.revision, setProps]);

  useEffect(() => {
    if (!matchesCopyResponse(virtualRangeData, copyPending.current)) return;
    if (typeof virtualRangeData.error === "string") {
      setCopyError(virtualRangeData.error);
      setCopyText(null);
    } else {
      setCopyText(virtualRangeData.text);
      setCopyError(null);
    }
  }, [virtualRangeData]);

  const copySelection = () => {
    if (typeof copyText !== "string") {
      if (globalRef.current && !copyPending.current) {
        const request=copyRequestFor(virtualDatasetId,
          ++copyCounter.current,globalRef.current);
        copyPending.current=request;
        setProps({virtualRangeRequest:request});
      }
      return;
    }
    // A textarea fallback works even where navigator.clipboard needs
    // additional permissions or the page is not a secure context.
    const textarea = document.createElement("textarea");
    textarea.value = copyText;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try { copied = document.execCommand("copy"); }
    finally { document.body.removeChild(textarea); }
    if (!copied && window.navigator.clipboard?.writeText) {
      window.navigator.clipboard.writeText(copyText).then(
        () => setCommandError(null),
        () => setCommandError("Clipboard permission denied; use Download CSV"),
      );
    } else if (!copied) {
      setCommandError("Clipboard is unavailable in this browser");
    } else setCommandError(null);
  };

  const exportUrl = props.virtualExportUrl && globalSelection
    ? props.virtualExportUrl +
      (props.virtualExportUrl.includes("?") ? "&" : "?") +
      new URLSearchParams({
        start: String(globalSelection.start), end: String(globalSelection.end),
        columnStart: String(globalSelection.columnStart),
        columnEnd: String(globalSelection.columnEnd),
        datasetId: props.editDatasetId,
      }).toString()
    : null;

  const publishChanges = (values) => {
    if (!page || editingBlocked) return;
    const allowed = values.filter((change) => {
      const offset = loadedRow(change.rowId, range, page);
      const column = columnById.get(change.columnId);
      return offset >= 0 && column && !column.nonEditable &&
        !locked.has(String(change.rowId) + "\u0000" + String(change.columnId));
    });
    if (!allowed.length) return;
    const next = applyChanges({data:page.data,rowIds:page.rowIds}, allowed,
      {columns:allColumns, newRow:props.newRow});
    if (!next.edits.length) return;
    // Persist to the ordered outbox BEFORE optimistically updating the
    // visible window. Reliable delivery and retry are handled by the hook.
    if (!submitOperation(next.edits)) return;
    setCache((prev) => addViewportCache(prev, key,
      {data:next.data,rowIds:next.rowIds,start:range.start}));
  };

  const latest = useRef(null);
  latest.current = {
    handleChanges: (changes) => {
      const edits = [];
      changes.forEach((change) => {
        const column = columnById.get(change.columnId);
        if (!column || !isDataId(change.rowId)) return;
        if (change.newCell.type === "dropdown") {
          const isOpen = change.newCell.isOpen;
          setOpenDropdown(isOpen ?
            {rowId:change.rowId,columnId:change.columnId} : null);
          if (change.newCell.selectedValue === change.previousCell.selectedValue)
            return;
        }
        edits.push({
          rowId:change.rowId, columnId:change.columnId,
          value:valueOf(column,change.newCell),
        });
      });
      publishChanges(edits);
    },
    selectionChanged: (ranges) => {
      selection.current = ranges;
      // ReactGrid's pointer and double-click handlers are sensitive to
      // rerendering their rows during selection. Keep ordinary selection
      // entirely in refs; use toolbar/Shift-click for global range state.
      const ids=rowsInRanges(ranges).filter(isDataId);
      setProps({selectedRange:ranges,selectedRowIds:ids});
      if (page && ranges.length && !shiftPointer.current) {
        const chosen=ranges[0];
        const indices=(chosen.rows || []).map((row) =>
          page.rowIds.indexOf(row.rowId)).filter((idx)=>idx>=0);
        if (indices.length) {
          globalRef.current=boundedSelection(
            range.start+Math.min(...indices),
            range.start+Math.max(...indices)+1,
            Math.min(chosen.first.column.idx,chosen.last.column.idx),
            Math.max(chosen.first.column.idx,chosen.last.column.idx)+1,
            virtualRowCount,columns.length,
          );
        }
      }
    },
    contextMenu: (selectedRowIds,selectedColIds,selectionMode,menuOptions) =>
      editingBlocked ? menuOptions : [...(menuOptions || []), {
        id:"deleteVirtualSelection",label:"Delete selected rows",
        handler: deleteSelection,
      }],
    focusChanged: (location) => {
      focused.current=location;
      if (!isDataId(location.rowId)) return;
      setProps({selectedCell:location});
      const place=selectionAt(location.rowId,location.columnId);
      if (!place) return;
      if (shiftPointer.current && anchor.current) {
        selectGlobal(extendSelection(
          anchor.current,place.row,place.col,
          virtualRowCount,columns.length,
        ));
      } else {
        // Ordinary single-cell focus must not modify React state in the
        // pointer event. ReactGrid's double-click editor depends on its
        // original cell element remaining mounted through both clicks.
        anchor.current=place;
        globalRef.current=boundedSelection(place.row,place.row+1,
          place.col,place.col+1,virtualRowCount,columns.length);
      }
    },
  };
  const onCellsChanged = useCallback((changes) => latest.current.handleChanges(changes),[]);
  const onSelectionChanged = useCallback((ranges) => latest.current.selectionChanged(ranges),[]);
  const onFocusLocationChanged = useCallback((loc) => latest.current.focusChanged(loc),[]);
  const onContextMenu = useCallback((...args) => latest.current.contextMenu(...args),[]);

  const handleCopy = (e) => {
    if (isCellEditorTarget(e.target)) return;
    // Native single-cell selection is copyable without any Dash request.
    // This also avoids stale, asynchronously prepared range clipboard data.
    const normal = selection.current;
    if (!globalSelection && normal.length) {
      const txt=selectionText(rows,normal,textOf);
      if (txt!==null) {
        e.preventDefault();e.stopPropagation();
        e.clipboardData.setData("text/plain",txt);
        return;
      }
    }
    if (!globalRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (reliable.pending > 0) {
      setCommandError("Save pending edits before copying a server range");
    } else if (typeof copyText === "string") {
      e.clipboardData.setData("text/plain",copyText);
      setCommandError(null);
    } else {
      setCommandError(copyError ||
        "Preparing selection for clipboard; press Ctrl+C again when ready");
    }
  };

  const handlePaste = (e) => {
    if (isCellEditorTarget(e.target) || editingBlocked) return;
    e.preventDefault();
    e.stopPropagation();
    if (!globalRef.current) {
      setCommandError("Select a destination row and column before pasting");
      return;
    }
    try {
      const edit=makeRangePaste(
        e.clipboardData.getData("text/plain"), globalRef.current,
        columns, virtualRowCount,
        (column,value) => pastedValue(column,{type:"text",text:value},parsers),
      );
      submitOperation([edit]);
    } catch (error) {
      setCommandError(error.message);
    }
  };

  const clearGlobal = () => {
    const sel=globalRef.current;
    if (!sel || editingBlocked) return;
    const count=sel.end-sel.start;
    const width=sel.columnEnd-sel.columnStart;
    if (count>MAX_RANGE_ROWS || count*width>20000) {
      setCommandError("Select at most 1,000 rows and 20,000 cells to clear");
      return;
    }
    const cols=columns.slice(sel.columnStart,sel.columnEnd);
    const blanks=cols.map((col)=>col.type==="checkbox"?false:
      ["number","percent","dropdown","date","time"].includes(col.type)?null:"");
    submitOperation([{kind:"paste",start:sel.start,
      columnIds:cols.map(col=>col.columnId),
      rows:Array.from({length:count},()=>blanks.slice()),
    }]);
  };

  const handleKey = (e) => {
    if (isCellEditorTarget(e.target)) return;
    const modified=(e.ctrlKey || e.metaKey) && !e.altKey;
    if (modified) {
      switch(e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          e.stopPropagation();
          if (virtualRowCount) {
            selectGlobal(boundedSelection(0,virtualRowCount,0,columns.length,
              virtualRowCount,columns.length));
            selection.current=[];
          }
          return;
        case "z":
          e.preventDefault();e.stopPropagation();
          if (e.shiftKey)redoOperation();
          else undoOperation();
          return;
        case "y":
          e.preventDefault();e.stopPropagation();
          redoOperation();
          return;
      }
    }
    if ((e.key==="Delete" || e.key==="Backspace") &&
        !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();e.stopPropagation();
      clearGlobal();
    }
  };

  const grid = useMemo(() => rows.length ? (
    <ReactGrid key={String(virtualDatasetId) + ":" + range.start + ":" + range.end}
      rows={rows} columns={columns}
      onCellsChanged={onCellsChanged}
      onSelectionChanged={onSelectionChanged}
      onFocusLocationChanged={onFocusLocationChanged}
      onContextMenu={onContextMenu}
      highlights={visibleHighlights}
      stickyTopRows={1}
      stickyLeftColumns={props.stickyLeftColumns || 0}
      stickyRightColumns={props.stickyRightColumns || 0}
      enableRangeSelection={props.enableRangeSelection !== false}
      enableRowSelection={props.enableRowSelection !== false}
      enableColumnSelection={props.enableColumnSelection !== false}
      enableFillHandle={props.enableFillHandle !== false && !editingBlocked}
      disableVirtualScrolling={false}
      customCellTemplates={dropdownMenuPortal ? portalTemplates : customCellTemplates}
    />
  ) : null,
  [rows,columns,onCellsChanged,onSelectionChanged,onFocusLocationChanged,onContextMenu,
   visibleHighlights,props.stickyLeftColumns,props.stickyRightColumns,
   props.enableRangeSelection,props.enableRowSelection,props.enableColumnSelection,
   props.enableFillHandle,editingBlocked,dropdownMenuPortal]);

  if (!valid) return <div role="alert" className="drg-virtual-error">
    Server virtualization needs a stable virtualDatasetId, nonnegative virtualRowCount,
    row height of at least 16px, window size of at least 20 and a positive viewport height.
  </div>;
  if (!columns.length) return <div role="alert">No visible columns.</div>;
  const selectedCount = globalSelection ? globalSelection.end - globalSelection.start : 0;

  return <div className="drg-virtual">
    <div className="drg-virtual-toolbar" aria-label="Server grid actions">
      <label>From row <input type="number" min="1"
        max={Math.max(1,virtualRowCount)} value={fromInput}
        onChange={(e) => setFromInput(e.target.value)}/></label>
      <label>To row <input type="number" min="1"
        max={Math.max(1,virtualRowCount)} value={toInput}
        onChange={(e) => setToInput(e.target.value)}/></label>
      <button type="button" disabled={!virtualRowCount} onClick={applyRangeInputs}>
        Select range</button>
      <button type="button" disabled={!virtualRowCount} onClick={() =>
        selectGlobal(boundedSelection(0,virtualRowCount,0,columns.length,
          virtualRowCount,columns.length))}>Select all</button>
      <span className="drg-selection-count">
        {globalSelection ? selectedCount.toLocaleString() + " rows selected" :
          virtualRowCount.toLocaleString() + " rows"}
      </span>
      <button type="button" disabled={!globalSelection ||
        reliable.pending > 0}
        onClick={copySelection}>
        {typeof copyText === "string" ? "Copy selection" : "Prepare copy"}</button>
      {exportUrl && <a href={exportUrl} download>Download selected CSV</a>}
      {!readOnly && props.transmitSparseEdits && <>
        <button type="button" disabled={editingBlocked}
          onClick={() => insertRow(false)}>Insert row</button>
        <button type="button" disabled={editingBlocked}
          onClick={() => insertRow(true)}>Append row</button>
        <button type="button" disabled={editingBlocked || !globalSelection ||
          selectedCount > MAX_RANGE_ROWS}
          onClick={deleteSelection}>Delete selected rows</button>
        <button type="button" disabled={editingBlocked || reliable.pending>0 ||
          !history.undo.length} onClick={undoOperation}>Undo</button>
        <button type="button" disabled={editingBlocked || reliable.pending>0 ||
          !history.redo.length} onClick={redoOperation}>Redo</button>
      </>}
    </div>
    {!virtualRowCount && <div className="drg-virtual-empty">No rows. Use Append row to create one.</div>}
    {(commandError || copyError || historyError) &&
      <div role="alert" className="drg-virtual-error">
        {[commandError,copyError,historyError].filter(Boolean).join(" ")}
      </div>}
    <div className="drg-virtual-viewport" ref={viewportRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onCopy={handleCopy} onPasteCapture={handlePaste}
      onKeyDownCapture={handleKey}
      onPointerDownCapture={(e) => {shiftPointer.current=e.shiftKey;}}
      onPointerUpCapture={() => {shiftPointer.current=false;}}
      style={{height:virtualViewportHeight,overflowY:"auto",overflowX:"auto"}}>
      {grid}
    </div>
    {loadError && <div role="alert" className="drg-virtual-error">
      Unable to load rows: {loadError}
      <button type="button" onClick={() => {
        setLoadError(null);
        requestWindow(range.start,range.end);
      }}>Retry</button>
    </div>}
    {props.transmitSparseEdits && <div className="drg-sync-status" role="status" aria-live="polite">
      {reliable.error ? (
        <>
          <span className="drg-sync-error">{reliable.error}. {reliable.pending} pending batch(es) retained.</span>
          {reliable.pending > 0 && <button type="button" onClick={reliable.retryFailed}>Retry sending</button>}
        </>
      ) : reliable.pending > 0 ? (
        <span>{reliable.pending} unacknowledged edit batch(es); retrying automatically</span>
      ) : <span>All edits acknowledged</span>}
    </div>}
    {loading && !loadError && <div className="drg-virtual-loading-status"
      aria-live="polite">Loading rows {range.start+1}–{range.end} of {virtualRowCount}</div>}
  </div>;
};
