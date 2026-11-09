import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactGrid } from "@silevis/reactgrid";
import { useReliableGrid } from "./useReliableGrid";
import { overlayVirtualEdits } from "./virtualOverlay";
import { clipboardStreamUrl, writeStreamedClipboard } from "./virtualClipboard";
import { compileGridColumns, visibleGridColumns, resizeGridColumns } from "./gridRows";
import { decodeGridData, isPackedNumericData } from "./numericData";
import {
  addViewportCache, buildVirtualRows, loadedRow, validViewportResponse,
  virtualRowWindow, viewportKey, VIRTUAL_LOADING_PREFIX,
  VIRTUAL_SPACER_TOP, VIRTUAL_SPACER_BOTTOM,
} from "./serverVirtual";
import {
  applyChanges, blankRow, columnClass, newRowId, pastedValue, rowsInRanges, textOf, valueOf,
} from "./model";
import {
  clearSelectedCells, focusedRange, isCellEditorTarget,
  selectAllRanges, selectionText,
} from "./keyboard";
import {
  boundedSelection, extendSelection, copyRequestFor, matchesCopyResponse,
  selectedColumnIds, editableFillColumns, escapeTsvCell,
  makeRangePaste, historyStorageKey, initialHistory, loadHistory,
  saveHistory, nextHistory, MAX_RANGE_ROWS,
} from "./virtualOperations";
import { numberParser } from "./CustomNumberCell";
import { percentParser } from "./PercentCell";
import { createCellTemplates } from "./cellTemplates";
import { sheetEdge, keyboardRectangle, keyboardArea } from "./spreadsheetKeyboard";

const parsers = { number: numberParser, percent: percentParser };
const EMPTY_DATA = [];
const EMPTY_IDS = [];
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
    virtualData: sourceVirtualData, virtualRangeData,
    virtualDatasetId, virtualRowHeight = 25, virtualWindowSize = 120,
    virtualViewportHeight = 420, setProps, readOnly, lockedCells,
    styleHeader, highlights, dropdownMenuPortal,
  } = props;

  const virtualData = useMemo(() => {
    if (!sourceVirtualData || !isPackedNumericData(sourceVirtualData.data))
      return sourceVirtualData;
    try {
      // Server windows are bounded: expose normal rows to the existing cache.
      const decoded = decodeGridData(sourceVirtualData.data);
      return { ...sourceVirtualData, data: decoded.toArray() };
    } catch (error) {
      return { ...sourceVirtualData, error: "Invalid binary viewport: " + error.message };
    }
  }, [sourceVirtualData]);
  const cellTemplates = useMemo(() => createCellTemplates(Boolean(dropdownMenuPortal)), [dropdownMenuPortal]);
  const viewportRef = useRef(null);
  const setPropsRef = useRef(setProps);
  setPropsRef.current = setProps;
  const [scrollTop, setScrollTop] = useState(0);
  const [virtualRowCount, setVirtualRowCount] = useState(suppliedRowCount);
  const rowCountRef = useRef(virtualRowCount);
  rowCountRef.current = virtualRowCount;
  const [globalSelection, setGlobalSelection] = useState(null);
  const globalRef = useRef(null);
  const anchor = useRef(null);
  const shiftPointer = useRef(false);
  const shiftClickColumn = useRef(null);
  const columnHeaderPointer = useRef(false);
  const pointerGesture = useRef(null);
  const [fromInput, setFromInput] = useState("1");
  const [toInput, setToInput] = useState("1");
  const [commandError, setCommandError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [copyText, setCopyText] = useState(null);
  const [copyError, setCopyError] = useState(null);
  const [streamingCopy, setStreamingCopy] = useState(false);
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
  const keyboardAnchor = useRef(null);
  const keyboardCursor = useRef(null);
  const [keyboardFocus, setKeyboardFocus] = useState(null);
  const multiCommit = useRef(false);
  const suppressNativeSelection = useRef(false);

  const columns = useMemo(() =>
    visibleGridColumns(allColumns, hiddenColumns), [allColumns, hiddenColumns]);
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
  // the application acknowledges the change and the viewport is invalidated.
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
    if (Number.isSafeInteger(ack.rowCount) && ack.rowCount >= 0) {
      if (ack.rowCount !== rowCountRef.current) {
        // Absolute indices are no longer meaningful after a structural
        // operation. Drop the old selection rather than copying/deleting
        // rows at positions shifted by the insert or removal.
        globalRef.current = null;
        anchor.current = null;
        setGlobalSelection(null);
        setCopyText(null);
      }
      setVirtualRowCount(ack.rowCount);
    }
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
    // A toolbar or keyboard range selection supersedes any older click.
    pointerGesture.current=null;
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
      (globalSelection?.start ?? globalRef.current?.start ?? range.first);
    const id = "new-" + (window.crypto?.randomUUID?.() || newRowId());
    submitOperation([{
      kind: "insert", rowId: id, position,
      values: blankRow(allColumns, props.newRow),
    }]);
  };

  const deleteSelection = () => {
    // Destructive toolbar actions operate on the displayed global range,
    // never on a later native cell focus that has not updated the toolbar.
    const sel = globalSelection;
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
      () => setPropsRef.current({virtualSelection:globalSelection}), 200);
    return () => window.clearTimeout(timer);
  }, [globalSelection]);

  // Prepare range data asynchronously via Dash, so the eventual Copy click
  // is a genuine user gesture and can use the synchronous clipboard event.
  useEffect(() => {
    setCopyText(null);
    setCopyError(null);
    copyPending.current=null;
    if (!globalSelection || props.virtualClipboardUrl) return;
    // A click focusing a single cell is NOT a request to fetch its content.
    // In particular, don't trigger a Dash response during double-click edit.
    if ((globalSelection.end - globalSelection.start) *
        (globalSelection.columnEnd - globalSelection.columnStart) === 1) return;
    // Copy limits do not apply to server-side fill operations.
    if (globalSelection.end - globalSelection.start > MAX_RANGE_ROWS) return;
    const timer = window.setTimeout(() => {
      if (copyPending.current) return;
      const request = copyRequestFor(virtualDatasetId,
        ++copyCounter.current, globalSelection, columns);
      copyPending.current = request;
      setPropsRef.current({virtualRangeRequest:request});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [globalSelection, virtualDatasetId, props.virtualClipboardUrl,
    props.editAck?.revision]);

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

  // Toolbar actions use the selection displayed in the toolbar. Keyboard
  // copy uses the native/focused range, which may differ after a cell click.
  const streamSelectionToClipboard = (selected) => {
    if (!selected) return;
    if (reliable.pending > 0) {
      setCopyError("Save pending edits before copying a server range");
      return;
    }
    try {
      const url=clipboardStreamUrl(
        props.virtualClipboardUrl,virtualDatasetId,selected,columns);
      // ClipboardItem accepts a Promise<Blob>. Start the write during the
      // user gesture, before awaiting the potentially large HTTP response.
      const writing=writeStreamedClipboard({
        url,clipboard:window.navigator.clipboard,
        ClipboardItemCtor:window.ClipboardItem,fetcher:window.fetch.bind(window),
      });
      setCopyError(null);
      setStreamingCopy(true);
      writing.then(() => {
        setStreamingCopy(false);
        setCopyError(null);
      }).catch(error => {
        setStreamingCopy(false);
        setCopyError(error.message || "Could not copy the selected range");
      });
    } catch(error) {
      setStreamingCopy(false);
      setCopyError(error.message || "Clipboard streaming unavailable");
    }
  };

  const copySelection = () => {
    if (props.virtualClipboardUrl) {
      streamSelectionToClipboard(globalSelection);
      return;
    }
    if (globalSelection &&
        globalSelection.end-globalSelection.start > MAX_RANGE_ROWS) {
      setCopyError("Use Download CSV for selections exceeding 1,000 rows");
      return;
    }
    if (typeof copyText !== "string") {
      if (globalSelection) {
        // A manual click is a retry even when an earlier prefetch is still
        // outstanding. Dash receives a fresh requestId to trigger the callback.
        const request=copyRequestFor(virtualDatasetId,
          ++copyCounter.current,globalSelection,columns);
        copyPending.current=request;
        setPropsRef.current({virtualRangeRequest:request});
        setCopyError(null);
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
        columnIds: JSON.stringify(selectedColumnIds(globalSelection, columns)),
        datasetId: props.editDatasetId,
      }).toString()
    : null;

  // A whole-column operation stays compact even when target rows have not
  // been requested from Dash. The server returns the normal durable edit ACK.
  const submitRepeated = (sel, values, start = sel.start, end = sel.end) => {
    if (end <= start) return;
    const target=columns.slice(sel.columnStart,sel.columnEnd);
    if (values.length !== target.length) return;
    const eligible=editableFillColumns(target,values);
    if (!eligible.columnIds.length) return;
    submitOperation([{kind:"fillRange",start,end,...eligible}]);
  };

  const fillDown = () => {
    if (editingBlocked) return;
    const sel=globalRef.current || globalSelection;
    if (!sel) return;
    const multiple=sel.end-sel.start>1;
    const sourceRow=multiple ? sel.start : sel.start-1;
    if (sourceRow<0) return;
    const target=editableFillColumns(
      columns.slice(sel.columnStart,sel.columnEnd));
    const start=multiple ? sel.start+1 : sel.start;
    if (start>=sel.end || !target.columnIds.length) return;
    // Resolve the source on the server, even if it is outside the viewport.
    submitOperation([{kind:"fillDown",sourceRow,start,end:sel.end,...target}]);
  };

  // Use absolute cell coordinates for Shift+Arrow rather than ReactGrid's
  // native selected rows, which can expand into unrelated columns after
  // a mouse click. No virtual row needs to be loaded to extend the range.
  const extendByArrow = (key) => {
    if (!virtualRowCount || !columns.length) return;
    const focusedPlace=focused.current
      ? selectionAt(focused.current.rowId,focused.current.columnId) : null;
    const current=keyboardCursor.current || focusedPlace ||
      (globalRef.current
        ? {row:globalRef.current.start,col:globalRef.current.columnStart} : null);
    if (!current) return;
    const next={...current};
    if (key==="ArrowDown") next.row=Math.min(next.row+1,virtualRowCount-1);
    else if (key==="ArrowUp") next.row=Math.max(0,next.row-1);
    else if (key==="ArrowRight") next.col=Math.min(next.col+1,columns.length-1);
    else if (key==="ArrowLeft") next.col=Math.max(0,next.col-1);
    const anchor=keyboardAnchor.current || focusedPlace || current;
    keyboardAnchor.current=anchor;
    keyboardCursor.current=next;
    suppressNativeSelection.current=true;
    const selected=keyboardRectangle(anchor,next);
    selectGlobal(boundedSelection(selected.start,selected.end,
      selected.columnStart,selected.columnEnd,
      virtualRowCount,columns.length));
    setCommandError(null);
  };

  const navigateToEdge = (key,shift) => {
    pointerGesture.current=null;
    if (!virtualRowCount) return;
    const focusedPlace=focused.current
      ? selectionAt(focused.current.rowId,focused.current.columnId) : null;
    const current=keyboardCursor.current || focusedPlace ||
      (globalRef.current
        ? {row:globalRef.current.start,col:globalRef.current.columnStart} : null);
    const target=sheetEdge(key,current,virtualRowCount,columns.length);
    if (!target) return;
    const anchor=shift ? keyboardAnchor.current || focusedPlace || current : target;
    keyboardAnchor.current=anchor;
    keyboardCursor.current=target;
    const next=keyboardRectangle(anchor,target);
    suppressNativeSelection.current=true;
    selectGlobal(boundedSelection(next.start,next.end,next.columnStart,
      next.columnEnd,virtualRowCount,columns.length));
    if (!shift) {
      setKeyboardFocus(target);
      const physicalHeight=Math.min(virtualRowCount*virtualRowHeight,20000000);
      const maximum=Math.max(0,physicalHeight-virtualViewportHeight);
      if (key==="ArrowDown" || key==="ArrowUp") {
        const position=target.row===0 ? 0 : maximum;
        if (viewportRef.current) viewportRef.current.scrollTop=position;
        setScrollTop(position);
      }
    }
    setCommandError(null);
  };

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
      if (multiCommit.current && changes.length===1) {
        multiCommit.current=false;
        const sel=globalRef.current || globalSelection;
        const change=changes[0];
        const source=columnById.get(change.columnId);
        if (sel && source && keyboardArea(sel)>1) {
          const raw=valueOf(source,change.newCell);
          const target=columns.slice(sel.columnStart,sel.columnEnd);
          const values=target.map((col)=>col.type===source.type
            ? raw : pastedValue(col,{type:"text",text:raw==null?"":String(raw)},parsers));
          submitRepeated(sel,values);
          return;
        }
      }
      multiCommit.current=false;
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
      if (suppressNativeSelection.current) return;
      selection.current = ranges;
      // ReactGrid's pointer and double-click handlers are sensitive to
      // rerendering their rows during selection. Keep ordinary selection
      // entirely in refs; use toolbar/Shift-click for global range state.
      const ids=rowsInRanges(ranges).filter(isDataId);
      setProps({selectedRange:ranges,selectedRowIds:ids});
      if (columnHeaderPointer.current) {
        // Header drags emit multiple selectionChanged events, including
        // another after pointer release. Keep interpreting them as whole
        // logical-column selections until the next user interaction.
        if (ranges.length && virtualRowCount) {
          const selected=ranges[0];
          const first=Math.min(selected.first.column.idx,selected.last.column.idx);
          const last=Math.max(selected.first.column.idx,selected.last.column.idx)+1;
          const whole=boundedSelection(0,virtualRowCount,first,last,
            virtualRowCount,columns.length);
          if (whole) selectGlobal(whole);
        }
        return;
      }
      if (shiftPointer.current && anchor.current && ranges.length && page) {
        // Shift-click can change ReactGrid's selection without changing its
        // focused cell, so focusChanged is not guaranteed to fire. Recover
        // the endpoint from the native selected range and retain the first
        // click as the keyboard-extension anchor.
        const chosen=ranges[0];
        const indices=(chosen.rows || []).map(row =>
          page.rowIds.indexOf(row.rowId)).filter(idx=>idx>=0);
        if (indices.length) {
          const firstRow=range.start+Math.min(...indices);
          const lastRow=range.start+Math.max(...indices);
          const anchored=anchor.current;
          const farRow=Math.abs(lastRow-anchored.row)>=
            Math.abs(firstRow-anchored.row) ? lastRow : firstRow;
          const firstCol=Math.min(chosen.first.column.idx,chosen.last.column.idx);
          const lastCol=Math.max(chosen.first.column.idx,chosen.last.column.idx);
          const farCol=Math.abs(lastCol-anchored.col)>=
            Math.abs(firstCol-anchored.col) ? lastCol : firstCol;
          const endpoint={row:farRow,
            col:shiftClickColumn.current ?? farCol};
          keyboardAnchor.current=anchored;
          keyboardCursor.current=endpoint;
          selectGlobal(extendSelection(anchored,endpoint.row,endpoint.col,
            virtualRowCount,columns.length));
        }
        return;
      }
      // After a plain click ReactGrid may retain a multi-column native
      // selection from an earlier keyboard range. Use the focused cell for
      // click-only gestures, but preserve native selections for real drags.
      const click=pointerGesture.current;
      if (click && !click.moved && focused.current) {
        const place=selectionAt(focused.current.rowId,focused.current.columnId);
        if (place) {
          globalRef.current=boundedSelection(place.row,place.row+1,
            place.col,place.col+1,virtualRowCount,columns.length);
          return;
        }
      }
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
    resizeColumn: (columnId, width, selectedColIds) => {
      const next = resizeGridColumns(allColumns, columnId, width, selectedColIds);
      if (next.some((column, index) => column !== allColumns[index]))
        setProps({columns: next});
    },
    contextMenu: (selectedRowIds,selectedColIds,selectionMode,menuOptions) =>
      editingBlocked || !globalSelection ? menuOptions : [...(menuOptions || []), {
        id:"deleteVirtualSelection",label:"Delete selected rows",
        handler: deleteSelection,
      }],
    focusChanged: (location) => {
      focused.current=location;
      // A header drag is a column selection even if ReactGrid briefly
      // reports focus on a loaded data cell during the gesture.
      if (columnHeaderPointer.current || !isDataId(location.rowId)) return;
      setProps({selectedCell:location});
      const place=selectionAt(location.rowId,location.columnId);
      if (!place) return;
      if (shiftPointer.current && anchor.current) {
        // Shift-click establishes the same anchor for subsequent Shift+Arrow
        // extensions. The focused cell is the moving end of the selection.
        keyboardAnchor.current=anchor.current;
        keyboardCursor.current=place;
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
  const onColumnResized = useCallback((...args) => latest.current.resizeColumn(...args),[]);
  const onContextMenu = useCallback((...args) => latest.current.contextMenu(...args),[]);

  // Copy a loaded single cell from the locally overlaid viewport, including
  // unacknowledged sparse edits. A server fetch could return stale content.
  const loadedSingleCellText = (candidate) => {
    if (!candidate || candidate.end-candidate.start!==1 ||
        candidate.columnEnd-candidate.columnStart!==1 || !page ||
        candidate.start<range.start ||
        candidate.start>=range.start+page.rowIds.length) return null;
    const rowOffset=candidate.start-range.start;
    const column=columns[candidate.columnStart];
    // Date/time cells render their values as date/time fields, not .text.
    // Read the overlaid page data, which includes optimistic edits, and
    // use the same raw serialisation as the streamed TSV endpoint.
    if (column?.type==="date" || column?.type==="time") {
      const originalColumn=allColumns.findIndex(c=>c.columnId===column.columnId);
      if (originalColumn<0) return null;
      const raw=page.data[rowOffset]?.[originalColumn];
      return escapeTsvCell(raw == null ? "" : raw);
    }
    const rowId=page.rowIds[rowOffset];
    const row=rows.find(item=>item.rowId===rowId);
    const cell=row?.cells?.[candidate.columnStart];
    return cell ? escapeTsvCell(textOf(cell)) : null;
  };

  const handleCopy = (e) => {
    if (isCellEditorTarget(e.target)) return;
    const selected=globalRef.current || globalSelection;
    const immediate=loadedSingleCellText(selected);
    if (immediate !== null) {
      e.preventDefault();e.stopPropagation();
      e.clipboardData.setData("text/plain",immediate);
      return;
    }
    if (props.virtualClipboardUrl && selected) {
      e.preventDefault();
      e.stopPropagation();
      streamSelectionToClipboard(selected);
      return;
    }
    // Native single-cell selection is copyable without any Dash request.
    // This also avoids stale, asynchronously prepared range clipboard data.
    const normal = selection.current;
    const current=globalRef.current;
    const toolbarMatches=current && globalSelection &&
      current.start===globalSelection.start &&
      current.end===globalSelection.end &&
      current.columnStart===globalSelection.columnStart &&
      current.columnEnd===globalSelection.columnEnd;
    if (!toolbarMatches && normal.length) {
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
    if (globalRef.current.end-globalRef.current.start > MAX_RANGE_ROWS) {
      setCommandError(props.virtualExportUrl
        ? "Select at most 1,000 rows to copy, or use Download selected CSV."
        : "Select at most 1,000 rows to copy, or configure virtualClipboardUrl for large selections.");
    } else if (reliable.pending > 0) {
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
    if (cols.some((col) => col.nonEditable)) {
      setCommandError("Cannot clear non-editable columns");
      return;
    }
    const blanks=cols.map((col)=>col.type==="checkbox"?false:
      ["number","percent","dropdown","date","time"].includes(col.type)?null:"");
    submitOperation([{kind:"paste",start:sel.start,
      columnIds:cols.map(col=>col.columnId),
      rows:Array.from({length:count},()=>blanks.slice()),
    }]);
  };

  const handleKey = (e) => {
    // The click marker belongs only to its pointer interaction. Clear it
    // before ReactGrid's native keyboard navigation fires selectionChanged,
    // otherwise Shift+Arrow can be mistaken for the earlier single click.
    if (pointerGesture.current && !pointerGesture.current.pressed)
      pointerGesture.current=null;
    // Keyboard input finishes any prior pointer gesture. The Shift-click
    // focus callback may arrive after pointerup, so it cannot be reset there.
    columnHeaderPointer.current=false;
    shiftPointer.current=false;
    shiftClickColumn.current=null;
    if (isCellEditorTarget(e.target)) {
      if (e.key==="Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey &&
          !e.altKey) multiCommit.current=true;
      return;
    }
    const modified=(e.ctrlKey || e.metaKey) && !e.altKey;
    if (modified && !e.shiftKey && e.key.toLowerCase()==="c" &&
        props.virtualClipboardUrl) {
      const selected=globalRef.current || globalSelection;
      // Let the native copy event synchronously set clipboardData for a
      // loaded cell, regardless of pending acknowledgements.
      if (loadedSingleCellText(selected)!==null) return;
      if (selected) {
        e.preventDefault(); e.stopPropagation();
        streamSelectionToClipboard(selected);
      }
      return;
    }
    if (modified && !e.shiftKey && (e.code==="Space" || e.key===" ")) {
      const cell=focused.current;
      const col=columns.findIndex(c=>c.columnId===cell?.columnId);
      if (col>=0 && virtualRowCount) {
        e.preventDefault();e.stopPropagation();
        selectGlobal(boundedSelection(0,virtualRowCount,col,col+1,
          virtualRowCount,columns.length));
      }
      return;
    }
    if (!modified && !e.shiftKey &&
        ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab","Enter"].includes(e.key)) {
      keyboardAnchor.current=null;
      keyboardCursor.current=null;
      suppressNativeSelection.current=false;
      setKeyboardFocus(null);
    }
    if (e.shiftKey && !modified &&
        ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
      e.preventDefault();e.stopPropagation();
      extendByArrow(e.key);
      return;
    }
    if (modified && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      navigateToEdge(e.key,e.shiftKey);
      return;
    }
    if (modified) {
      switch(e.key.toLowerCase()) {
        case "d":
          if (!e.shiftKey) {
            e.preventDefault();e.stopPropagation();
            fillDown();
          }
          return;
        case "a":
          pointerGesture.current=null;
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

  const keyboardFocusLocation = keyboardFocus && page &&
    keyboardFocus.row>=range.start &&
    keyboardFocus.row<range.start+page.rowIds.length
    ? {rowId:page.rowIds[keyboardFocus.row-range.start],
        columnId:columns[keyboardFocus.col]?.columnId} : undefined;
  const grid = useMemo(() => rows.length ? (
    <ReactGrid key={String(virtualDatasetId) + ":" + range.start + ":" + range.end}
      rows={rows} columns={columns}
      onCellsChanged={onCellsChanged}
      onSelectionChanged={onSelectionChanged}
      onFocusLocationChanged={onFocusLocationChanged}
      focusLocation={keyboardFocusLocation}
      onColumnResized={onColumnResized}
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
      customCellTemplates={cellTemplates}
    />
  ) : null,
  [rows,columns,onCellsChanged,onSelectionChanged,onFocusLocationChanged,onContextMenu,
   visibleHighlights,props.stickyLeftColumns,props.stickyRightColumns,
   props.enableRangeSelection,props.enableRowSelection,props.enableColumnSelection,
   props.enableFillHandle,editingBlocked,dropdownMenuPortal,cellTemplates,
   keyboardFocusLocation?.rowId,keyboardFocusLocation?.columnId]);

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
      <button type="button" disabled={!globalSelection || streamingCopy ||
        (!props.virtualClipboardUrl && selectedCount > MAX_RANGE_ROWS) ||
        reliable.pending > 0}
        onClick={copySelection}>
        {props.virtualClipboardUrl ? "Copy selection" :
          typeof copyText === "string" ? "Copy selection" : "Prepare copy"}</button>
      {streamingCopy && <span role="status">Copying selected range to clipboard</span>}
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
      onPointerDownCapture={(e) => {
        columnHeaderPointer.current=Boolean(props.enableColumnSelection &&
          e.target.closest?.(".rg-header-cell"));
        pointerGesture.current=(!e.shiftKey && !columnHeaderPointer.current &&
          e.target.closest?.(".rg-cell"))
          ? {x:e.clientX,y:e.clientY,moved:false,pressed:true} : null;
        shiftPointer.current=e.shiftKey;
        const cell=e.target.closest?.(".rg-cell");
        shiftClickColumn.current=e.shiftKey && cell
          ? columns.findIndex(column =>
              cell.classList.contains(columnClass(column.columnId))) : null;
        if (shiftClickColumn.current===-1) shiftClickColumn.current=null;
        keyboardAnchor.current=null;
        keyboardCursor.current=null;
        suppressNativeSelection.current=false;
        setKeyboardFocus(null);
      }}
      onPointerMoveCapture={(e) => {
        const gesture=pointerGesture.current;
        if (gesture?.pressed &&
            Math.abs(e.clientX-gesture.x)+Math.abs(e.clientY-gesture.y)>5)
          gesture.moved=true;
      }}
      onPointerUpCapture={() => {
        // ReactGrid may invoke focusChanged after pointerup capture; retain
        // shiftPointer until the next pointerdown/keydown to preserve the
        // anchor for the completed Shift-click selection.
        if (pointerGesture.current) pointerGesture.current.pressed=false;
      }}
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
