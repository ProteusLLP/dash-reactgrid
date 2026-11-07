import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactGrid } from "@silevis/reactgrid";
import { compileGridColumns } from "./gridRows";
import {
  addViewportCache, buildVirtualRows, loadedRow, validViewportResponse,
  virtualRowWindow, viewportKey, VIRTUAL_LOADING_PREFIX,
  VIRTUAL_SPACER_TOP, VIRTUAL_SPACER_BOTTOM,
} from "./serverVirtual";
import {
  applyChanges, pastedValue, rowIdsOf, rowsInRanges, textOf, valueOf,
} from "./model";
import {
  clearSelectedCells, focusedRange, isCellEditorTarget,
  selectAllRanges, selectionText,
} from "./keyboard";
import { numberParser } from "./CustomNumberCell";
import { percentParser } from "./PercentCell";
import { CustomNumberCellTemplate } from "./CustomNumberCell";
import { PercentCellTemplate } from "./PercentCell";
import { PortalDropdownCellTemplate } from "./PortalDropdownCell";

const parsers = { number: numberParser, percent: percentParser };
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
    columns: allColumns, hiddenColumns, virtualRowCount, virtualData,
    virtualDatasetId, virtualRowHeight = 25, virtualWindowSize = 120,
    virtualViewportHeight = 420, setProps, readOnly, lockedCells,
    styleHeader, highlights, dropdownMenuPortal,
  } = props;

  const viewportRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [cache, setCache] = useState(() => new Map());
  const [loadError, setLoadError] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const currentRequest = useRef(null);
  const requestCounter = useRef(0);
  const editCounter = useRef(0);
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
  const page = cache.get(key);
  const loading = valid && virtualRowCount > 0 && !page;

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

  const rows = useMemo(() => valid && columns.length && virtualRowCount > 0 ?
    buildVirtualRows({
      columns, descriptors, allColumns, rowCount:virtualRowCount, range,
      page, rowHeight:virtualRowHeight, readOnly, locked,
      styleHeader, openDropdown,
    }) : [],
    [valid, columns, descriptors, allColumns, virtualRowCount,
      range.start, range.end, page, virtualRowHeight, readOnly, locked,
      styleHeader, openDropdown]);

  const visibleHighlights = useMemo(() => {
    if (!highlights?.length || !page) return [];
    const visible = new Set(page.rowIds);
    const visibleColumns = new Set(columns.map((col) => col.columnId));
    return highlights.filter((mark) => visible.has(mark.rowId) &&
      visibleColumns.has(mark.columnId));
  }, [highlights, page, columns]);

  const publishChanges = (values) => {
    if (!page || readOnly) return;
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
    // Optimistic edits affect only the loaded window. The authoritative
    // server must persist the sparse batch and handle ACK/revision changes.
    setCache((prev) => addViewportCache(prev, key,
      {data:next.data,rowIds:next.rowIds}));
    setProps({edits:{seq:++editCounter.current,edits:next.edits}});
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
      const ids = rowsInRanges(ranges).filter(isDataId);
      setProps({selectedRange:ranges,selectedRowIds:ids});
    },
    focusChanged: (location) => {
      focused.current=location;
      if (isDataId(location.rowId)) setProps({selectedCell:location});
    },
  };
  const onCellsChanged = useCallback((changes) => latest.current.handleChanges(changes),[]);
  const onSelectionChanged = useCallback((ranges) => latest.current.selectionChanged(ranges),[]);
  const onFocusLocationChanged = useCallback((loc) => latest.current.focusChanged(loc),[]);

  const handleCopy = (e) => {
    if (isCellEditorTarget(e.target)) return;
    if (!selection.current.length) return;
    const text = selectionText(rows,selection.current,textOf);
    if (text === null) return;
    e.clipboardData.setData("text/plain",text);
    e.preventDefault();
  };
  const handlePaste = (e) => {
    if (isCellEditorTarget(e.target) || readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    if (!page || !selection.current.length) return;
    const sel=selection.current[0];
    const changes=[];
    const text=e.clipboardData.getData("text/plain").replace(/\r?\n$/,"");
    text.split("\n").forEach((line,ri) => {
      const row=rows[sel.first.row.idx+ri];
      if (!row || !isDataId(row.rowId)) return;
      line.split("\t").forEach((cell,ci) => {
        const column=columns[sel.first.column.idx+ci];
        if (!column) return;
        changes.push({rowId:row.rowId,columnId:column.columnId,
          value:pastedValue(column,{type:"text",text:cell.replace(/\r$/,"")},parsers)});
      });
    });
    publishChanges(changes);
  };

  const handleKey = (e) => {
    if (isCellEditorTarget(e.target)) return;
    if (e.key==="Delete" || e.key==="Backspace") {
      if (e.ctrlKey || e.metaKey || e.altKey || readOnly) return;
      const selected=selection.current.length ? selection.current :
        [focusedRange(rows,columns,focused.current)].filter(Boolean);
      const changes=clearSelectedCells(rows,columns,selected).filter(
        ({rowId}) => isDataId(rowId));
      if (changes.length) {
        e.preventDefault();
        e.stopPropagation();
        publishChanges(changes);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="a") {
      if (!e.shiftKey && !e.altKey) {
        const selected=selectAllRanges(selection.current,rows,columns,focused.current);
        if (selected) latest.current.selectionChanged(selected);
      }
    }
  };

  const grid = useMemo(() => rows.length ? (
    <ReactGrid rows={rows} columns={columns}
      onCellsChanged={onCellsChanged}
      onSelectionChanged={onSelectionChanged}
      onFocusLocationChanged={onFocusLocationChanged}
      highlights={visibleHighlights}
      stickyTopRows={1}
      stickyLeftColumns={props.stickyLeftColumns || 0}
      stickyRightColumns={props.stickyRightColumns || 0}
      enableRangeSelection={props.enableRangeSelection !== false}
      enableRowSelection={props.enableRowSelection !== false}
      enableColumnSelection={props.enableColumnSelection !== false}
      enableFillHandle={props.enableFillHandle !== false && !readOnly}
      disableVirtualScrolling={false}
      customCellTemplates={dropdownMenuPortal ? portalTemplates : customCellTemplates}
    />
  ) : null,
  [rows,columns,onCellsChanged,onSelectionChanged,onFocusLocationChanged,
   visibleHighlights,props.stickyLeftColumns,props.stickyRightColumns,
   props.enableRangeSelection,props.enableRowSelection,props.enableColumnSelection,
   props.enableFillHandle,readOnly,dropdownMenuPortal]);

  if (!valid) return <div role="alert" className="drg-virtual-error">
    Server virtualization needs a stable virtualDatasetId, nonnegative virtualRowCount,
    row height of at least 16px, window size of at least 20 and a positive viewport height.
  </div>;
  if (!columns.length) return <div role="alert">No visible columns.</div>;
  if (!virtualRowCount) return <div className="drg-virtual-empty">No rows</div>;

  return <div className="drg-virtual">
    <div className="drg-virtual-viewport" ref={viewportRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onCopy={handleCopy} onPasteCapture={handlePaste}
      onKeyDownCapture={handleKey}
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
    {loading && !loadError && <div className="drg-virtual-loading-status"
      aria-live="polite">Loading rows {range.start+1}–{range.end} of {virtualRowCount}</div>}
  </div>;
};
