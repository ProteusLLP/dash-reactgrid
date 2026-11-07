import { calendarDateFromValue } from "./keyboardEntry.js";
/*
 * Compile column metadata once and build only the requested rows.
 * ReactGrid still builds a cell matrix for every row passed to it.
 */
import { GHOST_ROW_ID, blankRow, columnClass, optionsOf } from "./model.js";

const alignStyle = (align) => {
  switch (align) {
    case "left": return { justifyContent: "flex-start" };
    case "center": return { justifyContent: "center" };
    case "right": return { justifyContent: "flex-end" };
    default: return {};
  }
};

/** Expensive Intl formatters and dropdown options are shared by all cells in a column. */
export const compileGridColumns = (visible, allColumns, locale) => {
  const indexes = new Map(allColumns.map((column, idx) => [column.columnId, idx]));
  return visible.map((column) => {
    let format;
    if (column.type === "number" || column.type === "customnumber") {
      format = new Intl.NumberFormat(locale, { ...column.formatOptions });
    } else if (column.type === "percent") {
      format = new Intl.NumberFormat(locale, { ...column.formatOptions, style: "percent" });
    } else if (column.type === "date" || column.type === "time") {
      format = new Intl.DateTimeFormat(locale, { ...column.formatOptions });
    }
    return {
      column,
      index: indexes.get(column.columnId),
      style: { ...alignStyle(column.align), ...column.style },
      className: [column.className, columnClass(column.columnId)].filter(Boolean).join(" "),
      format,
      values: column.type === "dropdown" ? optionsOf(column) : undefined,
      rules: (column.editableWhen || []).map((rule) => ({
        index: indexes.get(rule.columnId) ?? -1,
        in: rule.in,
        truthy: rule.truthy,
      })),
    };
  });
};

const rulesApply = (rules, values) => rules.every((rule) => {
  const value = values[rule.index];
  if (rule.in !== undefined) return rule.in.includes(value);
  if (rule.truthy !== undefined) return Boolean(value) === rule.truthy;
  return true;
});

const makeCell = (render, value, locked, open) => {
  const { column, style, className, format, values } = render;
  const base = { style, nonEditable: locked, className };
  switch (column.type) {
    case "number":
    case "customnumber":
      return { ...base, type: "customnumber", value: value ?? NaN, format };
    case "percent":
      return { ...base, type: "percent", value: value ?? NaN, format };
    case "dropdown":
      return { ...base, type: "dropdown", selectedValue: value ?? undefined, values, isOpen: open, isDisabled: locked };
    case "checkbox":
      return { ...base, type: "checkbox", checked: Boolean(value) };
    case "date":
      return { ...base, type: "date", date: calendarDateFromValue(value), format };
    case "time":
      return { ...base, type: "time", time: value ? new Date(value) : undefined, format };
    default:
      return { ...base, type: "text", text: value == null ? "" : String(value) };
  }
};

/**
 * Returns ReactGrid rows and a reusable cache for the next render.
 *
 * Data and ids here are already restricted to the current page.
 * Cache only rows with the identical value-array reference and dropdown state.
 * A caller must discard the cache when columns, locks, or settings change.
 */
export const buildGridRows = ({
  columns, descriptors, allColumns, data, rowIds, newRow,
  readOnly, locked, styleHeader, showGhost, openDropdown, previous,
}) => {
  const cache = new Map();
  const createRow = (rowId, values, ruleValues = values) => {
    const dropdownColumn = openDropdown?.rowId === rowId ? openDropdown.columnId : null;
    const prior = previous?.get(rowId);
    if (prior && prior.values === values && prior.dropdownColumn === dropdownColumn) {
      cache.set(rowId, prior);
      return prior.row;
    }
    const row = {
      rowId,
      cells: descriptors.map((render) => {
        const { column } = render;
        const applies = rulesApply(render.rules, ruleValues);
        const cellLocked = !applies || readOnly || Boolean(column.nonEditable) ||
          locked.has(`${rowId}\u0000${column.columnId}`);
        const cell = makeCell(render, values[render.index], cellLocked, dropdownColumn === column.columnId);
        const marks = [
          cell.className,
          !applies && "rg-cell-na",
          !cell.nonEditable && "rg-cell-editable",
          rowId === GHOST_ROW_ID && "rg-ghost",
        ];
        return {
          ...cell,
          // ReactGrid's dropdown template appends "open"/"closed" without a space.
          className: marks.filter(Boolean).join(" ") + (cell.type === "dropdown" ? " " : ""),
        };
      }),
    };
    cache.set(rowId, { row, values, dropdownColumn });
    return row;
  };
  const header = {
    rowId: "header",
    cells: columns.map((column) => ({
      type: "header",
      text: column.title,
      ...(typeof column.tooltip === "string" && column.tooltip ? { tooltip: column.tooltip } : {}),
      style: { ...styleHeader, ...column.headerStyle, ...alignStyle(column.align) },
    })),
    height: styleHeader?.height,
  };
  const rows = [header, ...data.map((values, index) => createRow(rowIds[index], values))];
  if (showGhost) {
    rows.push(createRow(GHOST_ROW_ID, blankRow(allColumns, null), blankRow(allColumns, newRow)));
  }
  return { rows, cache };
};

/** Page boundaries, independent of the size of the source data. */
export const pageBounds = (count, size, requestedPage) => {
  if (!Number.isInteger(size) || size <= 0) {
    return { page: 0, count: 1, start: 0, end: count };
  }
  const pages = Math.max(1, Math.ceil(count / size));
  const validPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0;
  const page = Math.max(0, Math.min(pages - 1, validPage));
  const start = page * size;
  return { page, count: pages, start, end: Math.min(start + size, count) };
};

/** Guard against pasting into rows on a different, non-final page. */
export const canPasteOnPage = (position, bounds, pageSize) =>
  !pageSize || bounds.page === bounds.count - 1 || position < bounds.end;
