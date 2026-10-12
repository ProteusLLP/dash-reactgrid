/*
 * The grid's data model, free of React so it can be tested on its own.
 *
 * The table is `data` (one array of values per row, in column order) with a
 * parallel `rowIds`. Every change the user makes is turned into the new table
 * and a list of edits, each naming rows by id, so a server can replay them
 * against what it mounted:
 *
 *   {kind: "cell", rowId, columnId, value}
 *   {kind: "add", rowId}
 *   {kind: "remove", rowIds}
 *
 * An extendable table shows one blank row after its data, the ghost row.
 * Changing a ghost row cell adds a row, filled from `newRow`, before the cell
 * edit applies.
 */

export const GHOST_ROW_ID = "__ghost__";
export const NEW_ROW_PREFIX = "new-";

const NUMERIC_TYPES = ["number", "customnumber", "percent"];
const TRUE_TEXT = ["true", "yes", "1", "y", "x"];

/** A fresh id for a row the user added. */
export const newRowId = () =>
  NEW_ROW_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** The ids of the rows, using positions where the caller gave none. */
export const rowIdsOf = (data, rowIds) =>
  data.map((_, idx) => (rowIds && rowIds[idx] !== undefined ? rowIds[idx] : idx));

/** A column's dropdown options as ReactGrid wants them. */
export const optionsOf = (column) =>
  (column.values || []).map((option) =>
    typeof option === "object" ? option : { label: String(option), value: option }
  );

/** A number, or null for anything that is not one (NaN does not survive JSON). */
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The stored value of a cell, by the column's type. */
export const valueOf = (column, cell) => {
  switch (column.type) {
    case "text":
      return cell.text ?? "";
    case "number":
    case "customnumber":
    case "percent":
      return finite(cell.value);
    case "dropdown":
      return cell.selectedValue ?? null;
    case "checkbox":
      return Boolean(cell.checked);
    case "date":
      return cell.date ?? null;
    case "time":
      return cell.time ?? null;
    default:
      return cell.text ?? null;
  }
};

/**
 * The value pasted text gives a column.
 *
 * @param {object} column The column.
 * @param {string} text The pasted text.
 * @param {object} parsers `number` and `percent` parsers with `parse(text)`.
 */
export const parseText = (column, text, parsers) => {
  const trimmed = String(text ?? "").trim();
  switch (column.type) {
    case "number":
    case "customnumber":
      return trimmed === "" ? null : finite(parsers.number.parse(trimmed));
    case "percent":
      // "35%" is a percentage; a bare "0.35", as Excel and this grid copy
      // their values, is the fraction itself.
      if (trimmed === "") return null;
      return trimmed.includes("%")
        ? finite(parsers.percent.parse(trimmed))
        : finite(parsers.number.parse(trimmed));
    case "checkbox":
      return TRUE_TEXT.includes(trimmed.toLowerCase());
    case "dropdown": {
      const options = optionsOf(column);
      const match = options.find(
        (o) => String(o.value) === trimmed || String(o.label) === trimmed
      );
      return match ? match.value : null;
    }
    default:
      return String(text ?? "");
  }
};

/** A pasted cell's value, keeping the type when it came from a grid. */
export const pastedValue = (column, cell, parsers) => {
  if (NUMERIC_TYPES.includes(column.type) && typeof cell.value === "number") {
    return finite(cell.value);
  }
  if (column.type === "checkbox" && typeof cell.checked === "boolean") {
    return cell.checked;
  }
  return parseText(column, cell.text ?? cell.selectedValue ?? cell.value, parsers);
};

/** The value of a cell as copied to the clipboard. */
export const textOf = (cell) => {
  switch (cell.type) {
    case "customnumber":
    case "number":
    case "percent":
      return Number.isFinite(cell.value)
        ? cell.value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 17 })
        : "";
    case "checkbox":
      return cell.checked ? "TRUE" : "FALSE";
    case "dropdown":
      return cell.selectedValue ?? "";
    default:
      return cell.text ?? "";
  }
};

/**
 * Whether a column's `editableWhen` rules hold for a row.
 *
 * Each rule names another column and requires its value to be truthy
 * (`{columnId, truthy: true}`), falsy (`truthy: false`) or one of `in`.
 */
export const rulesHold = (column, values, columnIds) =>
  (column.editableWhen || []).every((rule) => {
    const value = values[columnIds.indexOf(rule.columnId)];
    if (rule.in !== undefined) return rule.in.includes(value);
    if (rule.truthy !== undefined) return Boolean(value) === rule.truthy;
    return true;
  });

/** A blank row, or one filled from `newRow` (an array or an object by column id). */
export const blankRow = (columns, newRow) =>
  columns.map((column, idx) => {
    if (Array.isArray(newRow)) return newRow[idx] ?? null;
    if (newRow && typeof newRow === "object") return newRow[column.columnId] ?? null;
    return null;
  });

/**
 * Apply cell changes to the table.
 *
 * @param {object} table `{data, rowIds}`.
 * @param {Array} changes `{rowId, columnId, value}` per changed cell; a
 *   `rowId` of `GHOST_ROW_ID`, or a row index past the end given as
 *   `{ghost: n}`, adds rows.
 * @param {object} options `columns`, `newRow` and `makeId`.
 * @returns {object} `{data, rowIds, edits}`.
 */
export const applyChanges = (table, changes, { columns, newRow, makeId = newRowId }) => {
  const data = table.data.map((row) => [...row]);
  const rowIds = [...table.rowIds];
  const edits = [];
  const added = new Map();
  const columnIds = columns.map((c) => c.columnId);

  const indexOf = (rowId) => {
    if (rowId === GHOST_ROW_ID || (rowId && typeof rowId === "object")) {
      const key = rowId === GHOST_ROW_ID ? 0 : rowId.ghost;
      if (!added.has(key)) {
        // Rows past the end are added in order, so a paste keeps its shape.
        for (let k = added.size; k <= key; k++) {
          if (added.has(k)) continue;
          const id = makeId();
          added.set(k, data.length);
          data.push(blankRow(columns, newRow));
          rowIds.push(id);
          edits.push({ kind: "add", rowId: id });
        }
      }
      return added.get(key);
    }
    return rowIds.indexOf(rowId);
  };

  changes.forEach(({ rowId, columnId, value }) => {
    const col = columnIds.indexOf(columnId);
    const row = indexOf(rowId);
    if (col < 0 || row < 0) return;
    if (Object.is(data[row][col], value)) return;
    data[row][col] = value;
    edits.push({ kind: "cell", rowId: rowIds[row], columnId, value });
  });
  return { data, rowIds, edits };
};

/**
 * Remove rows from the table.
 *
 * @param {object} table `{data, rowIds}`.
 * @param {Array} removing The ids of the rows to remove.
 * @returns {object} `{data, rowIds, edits}`.
 */
export const removeRows = (table, removing) => {
  const gone = new Set(removing.filter((id) => table.rowIds.includes(id)));
  if (gone.size === 0) return { data: table.data, rowIds: table.rowIds, edits: [] };
  const keep = table.rowIds.map((id) => !gone.has(id));
  return {
    data: table.data.filter((_, idx) => keep[idx]),
    rowIds: table.rowIds.filter((_, idx) => keep[idx]),
    edits: [{ kind: "remove", rowIds: [...gone] }],
  };
};

/** The distinct row ids a set of selected ranges covers, ghost row aside. */
export const rowsInRanges = (ranges) => {
  const ids = [];
  (ranges || []).forEach((range) =>
    (range.rows || []).forEach((row) => {
      if (row.rowId !== "header" && row.rowId !== GHOST_ROW_ID && !ids.includes(row.rowId)) {
        ids.push(row.rowId);
      }
    })
  );
  return ids;
};

/**
 * Sticky row and column counts that leave at least one of each to scroll.
 *
 * @param {object} props `stickyLeftColumns`, `stickyRightColumns`,
 *   `stickyTopRows` and `stickyBottomRows`.
 * @param {number} columns How many columns the grid shows.
 * @param {number} rows How many rows, the header included.
 */
export const stickyCounts = (props, columns, rows) => {
  const fit = (first, second, total) => {
    const a = Math.max(0, Math.min(first || 0, total - 1));
    const b = Math.max(0, Math.min(second || 0, total - 1 - a));
    return [a, b];
  };
  const [left, right] = fit(props.stickyLeftColumns, props.stickyRightColumns, columns);
  const [top, bottom] = fit(props.stickyTopRows, props.stickyBottomRows, rows);
  return { left, right, top, bottom };
};

/** The class every cell of a column carries, `rg-col-<column id>`, for styling and tests. */
export const columnClass = (columnId) =>
  `rg-col-${String(columnId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
