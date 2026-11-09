/*
 * Server-backed row virtualization, independent of React.
 *
 * The browser sends requests for bounded, absolute row intervals. It never
 * materializes the full table. Two spacer rows preserve the logical scroll
 * height while ReactGrid builds cells only for the current row interval.
 */
import { blankRow } from "./model.js";
import { buildGridRows } from "./gridRows.js";

export const VIRTUAL_SPACER_TOP = "__drg_virtual_spacer_top__";
export const VIRTUAL_SPACER_BOTTOM = "__drg_virtual_spacer_bottom__";
export const VIRTUAL_LOADING_PREFIX = "__drg_virtual_loading_";
export const DEFAULT_VIRTUAL_WINDOW_SIZE = 120;
export const DEFAULT_VIRTUAL_ROW_HEIGHT = 25;
export const MAX_BROWSER_SCROLL_PX = 20_000_000;

export const virtualRowWindow = (scrollTop, total, rowHeight = DEFAULT_VIRTUAL_ROW_HEIGHT,
  windowSize = DEFAULT_VIRTUAL_WINDOW_SIZE, viewportHeight = 400) => {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError("virtualRowCount must be a nonnegative integer");
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) throw new RangeError("virtualRowHeight must be positive");
  if (!Number.isSafeInteger(windowSize) || windowSize <= 0) throw new RangeError("virtualWindowSize must be a positive integer");
  const visible = Math.ceil(Math.max(1, viewportHeight) / rowHeight) + 2;
  const size = Math.max(windowSize, visible * 3);
  const totalHeight = Math.min(total * rowHeight, MAX_BROWSER_SCROLL_PX);
  // Cap the physical scrollbar height and map scroll offsets to the actual
  // row index for datasets larger than the browser's CSS pixel limit.
  const maximum = Math.max(0, totalHeight - viewportHeight);
  const position = Math.max(0, Math.min(Number.isFinite(scrollTop) ? scrollTop : 0, maximum));
  const first = total <= visible ? 0 :
    Math.min(total - visible, Math.floor(position / Math.max(1, maximum) * (total - visible)));
  const maxStart = Math.max(0, total - size);
  // The window's physical top spacer spans 0..(scrollHeight - windowHeight).
  // Locate the window over that same interval; this keeps the scroll offset
  // aligned with full-height loaded cells, including at the bottom.
  const fraction = maximum ? position / maximum : 0;
  const idealStart = Math.floor(fraction * maxStart);
  const step = Math.max(1, Math.floor(size / 2));
  let start = position >= maximum ? maxStart
    : Math.min(maxStart, Math.floor(idealStart / step) * step);
  // Never allow the selected visual range to fall into a compressed spacer.
  start = Math.max(start, Math.max(0, first + visible - size));
  start = Math.min(start, Math.max(0, first));
  const end = Math.min(total, start + size);
  return { start, end, first, visible, size, totalHeight };
};

/** Scroll position that brings a logical row into the virtual viewport.
 * The mapping mirrors virtualRowWindow's compressed physical scrollbar.
 */
export const scrollTopForVirtualRow = (row, total, rowHeight, viewportHeight, alignToTop=false) => {
  if (total <= 0 || row < 0 || row >= total) return 0;
  const visible = Math.ceil(Math.max(1, viewportHeight) / rowHeight) + 2;
  const pageRows = Math.max(1, Math.floor((viewportHeight-rowHeight) / rowHeight));
  const first = alignToTop ? row : Math.max(0, row-pageRows+1);
  const maxFirst = Math.max(0, total-visible);
  const maxScroll = Math.max(0, Math.min(total*rowHeight,
    MAX_BROWSER_SCROLL_PX)-viewportHeight);
  const desired = maxFirst ? Math.min(first,maxFirst) / maxFirst * maxScroll : 0;
  // At the top, don't scroll past the requested row. At the bottom, round
  // forward so the moving endpoint is inside the visible portion.
  return Math.min(maxScroll,alignToTop ? Math.floor(desired) : Math.ceil(desired));
};

export const viewportKey = (datasetId, start, end) =>
  JSON.stringify([datasetId, start, end]);

export const validViewportResponse = (response, request, columns) => {
  if (!response || !request ||
      response.datasetId !== request.datasetId ||
      response.requestId !== request.requestId ||
      response.start !== request.start ||
      !Array.isArray(response.data) || !Array.isArray(response.rowIds) ||
      response.data.length !== request.end - request.start ||
      response.rowIds.length !== response.data.length ||
      response.rowIds.some((id) => typeof id !== "string" &&
        !(typeof id === "number" && Number.isSafeInteger(id))) ||
      new Set(response.rowIds).size !== response.rowIds.length ||
      response.data.some((row) => !Array.isArray(row) || row.length !== columns.length))
    return false;
  return true;
};

export const addViewportCache = (cache, key, response, limit = 4) => {
  const next = new Map(cache);
  next.delete(key);
  next.set(key, { data: response.data, rowIds: response.rowIds, start: response.start });
  while (next.size > limit) next.delete(next.keys().next().value);
  return next;
};

export const buildVirtualRows = ({
  columns, descriptors, allColumns, rowCount, range, page, rowHeight,
  readOnly, locked, styleHeader, openDropdown, selection,
}) => {
  const spacer = (id, height) => ({
    rowId: id,
    height,
    cells: columns.map(() => ({ type: "text", text: "", nonEditable: true,
      className: "rg-virtual-spacer" })),
  });

  const loaded = Boolean(page);
  const rangeSize = range.end - range.start;
  const data = loaded ? page.data : Array.from({length:rangeSize}, () => blankRow(allColumns, null));
  const ids = loaded ? page.rowIds :
    Array.from({length:rangeSize}, (_,i) => VIRTUAL_LOADING_PREFIX + (range.start+i));
  const built = buildGridRows({
    columns, descriptors, allColumns, data, rowIds:ids,
    readOnly, locked, styleHeader, showGhost:false, openDropdown,
  });
  // Keep loaded rows at full, readable height. Only the offscreen spacer
  // distances are compressed when the logical table exceeds browser limits.
  // Mapping the window start over the available physical spacer distance
  // also ensures the final rows line up with the bottom of the scrollbar.
  const windowHeight = rangeSize * rowHeight;
  const physicalHeight = Math.min(rowCount * rowHeight, MAX_BROWSER_SCROLL_PX);
  const spacerHeight = Math.max(0, physicalHeight - windowHeight);
  const maxStart = Math.max(0, rowCount - rangeSize);
  const topHeight = maxStart
    ? Math.min(spacerHeight, Math.max(0, range.start / maxStart * spacerHeight))
    : 0;
  const rows = [built.rows[0]];
  if (topHeight > 0) rows.push(spacer(VIRTUAL_SPACER_TOP, topHeight));
  for (let i=0;i<rangeSize;i++) {
    const rendered = built.rows[i+1];
    rows.push({
      ...rendered, height: rowHeight,
      cells: loaded ? rendered.cells.map((cell,j) => {
        const globalRow = range.start + i;
        const selected = selection && globalRow >= selection.start &&
          globalRow < selection.end && j >= selection.columnStart &&
          j < selection.columnEnd;
        return selected ? { ...cell, className: (cell.className || "") + " rg-virtual-selected" } : cell;
      }) : rendered.cells.map((cell,j) => ({
        type:"text", text:j===0 ? "Loading…" : "", nonEditable:true,
        className:"rg-virtual-loading",
      })),
    });
  }
  const bottomHeight = spacerHeight - topHeight;
  if (bottomHeight > 0) rows.push(spacer(VIRTUAL_SPACER_BOTTOM, bottomHeight));
  return rows;
};

/** An edit is permitted only on a loaded row, never on spacers/placeholders. */
export const loadedRow = (rowId, range, page) => {
  if (!page) return -1;
  return page.rowIds.indexOf(rowId);
};
