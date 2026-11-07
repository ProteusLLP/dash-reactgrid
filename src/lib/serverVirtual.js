/*
 * Server-backed row virtualization, independent of React.
 *
 * The browser sends requests for bounded, absolute row intervals. It never
 * materializes the full table. Two spacer rows preserve the logical scroll
 * height while ReactGrid builds cells only for the current row interval.
 */
import { blankRow } from "./model.js";

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
  const step = Math.max(1, Math.floor(size / 2));
  const start = Math.min(maxStart, Math.max(0, Math.floor(first / step) * step - Math.floor(size / 4)));
  const end = Math.min(total, start + size);
  return { start, end, first, visible, size, totalHeight };
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
      response.rowIds.some((id) => id === null || id === undefined ||
        (typeof id !== "number" && typeof id !== "string")) ||
      new Set(response.rowIds).size !== response.rowIds.length ||
      response.data.some((row) => !Array.isArray(row) || row.length !== columns.length))
    return false;
  return true;
};

export const addViewportCache = (cache, key, response, limit = 4) => {
  const next = new Map(cache);
  next.delete(key);
  next.set(key, { data: response.data, rowIds: response.rowIds });
  while (next.size > limit) next.delete(next.keys().next().value);
  return next;
};

export const buildVirtualRows = ({
  columns, descriptors, rowCount, range, page, rowHeight,
  readOnly, locked, styleHeader, openDropdown,
}) => {
  const header = {
    rowId: "header",
    height: styleHeader?.height || DEFAULT_VIRTUAL_ROW_HEIGHT,
    cells: columns.map((column) => ({
      type: "header", text: column.title,
      style: { ...styleHeader, ...column.headerStyle },
    })),
  };
  const spacer = (id, height) => ({
    rowId: id,
    height,
    cells: columns.map(() => ({ type: "text", text: "", nonEditable: true,
      className: "rg-virtual-spacer" })),
  });
  const rows = [header];
  // Spacer height follows the *physical* scrollbar scale. With very large
  // counts ReactGrid's own scroll geometry must use the same scale.
  const scale = rowCount * rowHeight > MAX_BROWSER_SCROLL_PX
    ? MAX_BROWSER_SCROLL_PX / (rowCount * rowHeight) : 1;
  const topHeight = range.start * rowHeight * scale;
  if (topHeight > 0) rows.push(spacer(VIRTUAL_SPACER_TOP, topHeight));
  for (let i = range.start; i < range.end; i++) {
    const offset = i - range.start;
    const present = Boolean(page);
    const id = present ? page.rowIds[offset] : VIRTUAL_LOADING_PREFIX + i;
    const values = present ? page.data[offset] : blankRow(columns, null);
    const cells = descriptors.map((render) => {
      const { column } = render;
      const lockedCell = !present || readOnly || Boolean(column.nonEditable) ||
        locked.has(String(id) + "\u0000" + String(column.columnId));
      const value = values[render.index];
      const base = { nonEditable: lockedCell, style: render.style,
        className: [render.className, present ? "rg-cell-editable" : "rg-virtual-loading"].join(" ") };
      if (column.type === "number") return { ...base, type: "customnumber", value: value ?? NaN, format: render.format };
      if (column.type === "percent") return { ...base, type: "percent", value: value ?? NaN, format: render.format };
      if (column.type === "checkbox") return { ...base, type: "checkbox", checked: Boolean(value) };
      if (column.type === "dropdown") return {
        ...base, type: "dropdown", selectedValue: value ?? undefined,
        values: render.values, isDisabled: lockedCell,
        isOpen: openDropdown?.rowId === id && openDropdown?.columnId === column.columnId,
      };
      return { ...base, type: "text", text: present ? (value == null ? "" : String(value)) :
        (render.index === 0 ? "Loading…" : "") };
    });
    rows.push({ rowId: id, height: rowHeight * scale, cells });
  }
  const bottomHeight = (rowCount - range.end) * rowHeight * scale;
  if (bottomHeight > 0) rows.push(spacer(VIRTUAL_SPACER_BOTTOM, bottomHeight));
  return rows;
};

/** An edit is permitted only on a loaded row, never on spacers/placeholders. */
export const loadedRow = (rowId, range, page) => {
  if (!page) return -1;
  return page.rowIds.indexOf(rowId);
};
