// Deterministic shared dataset and sparse edit protocol. No React or grid dependencies.
// Every renderer receives the same schema, initial values and edit/lock validation.
export const MIXED_COLUMNS = Object.freeze([
  { columnId: "label", title: "Name", type: "text", width: 175 },
  { columnId: "amount", title: "Amount", type: "number", width: 130 },
  { columnId: "ratio", title: "Ratio", type: "percent", width: 115 },
  { columnId: "flag", title: "Flag", type: "checkbox", width: 90 },
  { columnId: "choice", title: "Choice", type: "dropdown", values: ["A", "B", "C"], width: 130 },
  { columnId: "date", title: "Date", type: "date", width: 130 },
  { columnId: "time", title: "Time", type: "time", width: 105 },
  { columnId: "locked", title: "Read-only", type: "text", width: 140, nonEditable: true },
]);

export function parseOptions(search = "") {
  const p = new URLSearchParams(search);
  const integer = (value, fallback, max) =>
    value === null || !/^\d+$/.test(value) ? fallback : Math.max(1, Math.min(max, Number(value)));
  return {
    renderer: ["reactgrid", "glide", "revogrid"].includes(p.get("renderer"))
      ? p.get("renderer") : "glide",
    rows: integer(p.get("rows"), 100_000, 1_000_000),
    cols: integer(p.get("cols"), 12, 64),
    mode: p.get("mode") === "mixed" ? "mixed" : "numeric",
  };
}

export class Fixture {
  constructor({ rows, cols, mode }) {
    const start = performance.now();
    this.rowCount = rows;
    this.mode = mode;
    this.columns = mode === "mixed" ? MIXED_COLUMNS : Array.from({ length: cols }, (_, i) => ({
      columnId: "n" + i, title: "Number " + i, type: "number", width: 118,
    }));
    this.numeric = null;
    if (mode === "numeric") {
      if (rows * this.columns.length > 4_000_000)
        throw new RangeError("Numeric fixture capped at four million cells (32 MB)");
      this.numeric = new Float64Array(rows * this.columns.length);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < this.columns.length; c++)
          this.numeric[r * this.columns.length + c] = (r + 1) * 0.01 + c / 100;
      }
    }
    this.edits = [];
    this.overrides = new Map();
    this.initializationMs = performance.now() - start;
  }

  rowId(row) { return "r-" + row; }
  columnIndex(columnId) { return this.columns.findIndex(c => c.columnId === columnId); }
  key(row, col) { return row + ":" + col; }

  get(row, col) {
    if (row < 0 || row >= this.rowCount || col < 0 || col >= this.columns.length)
      return null;
    const key = this.key(row, col);
    if (this.overrides.has(key)) return this.overrides.get(key);
    if (this.numeric) return this.numeric[row * this.columns.length + col];
    switch (this.columns[col].columnId) {
      case "label": return "Row " + row;
      case "amount": return row + 0.125;
      case "ratio": return (row % 100) / 100;
      case "flag": return row % 2 === 0;
      case "choice": return ["A", "B", "C"][row % 3];
      case "date": return "2026-11-" + String(row % 28 + 1).padStart(2, "0");
      case "time": return "09:" + String(row % 60).padStart(2, "0");
      case "locked": return "LOCKED " + row;
      default: return null;
    }
  }

  coerce(col, input) {
    const definition = this.columns[col];
    if (!definition) return { ok: false, value: null };
    switch (definition.type) {
      case "number":
      case "percent": {
        if (input === "" || input === null || input === undefined)
          return { ok: true, value: null };
        const val = typeof input === "string" && input.trim().endsWith("%")
          ? Number(input.trim().slice(0, -1)) / 100 : Number(input);
        return { ok: Number.isFinite(val), value: val };
      }
      case "checkbox":
        return { ok: true, value: input === true || input === 1 || /^(true|1|yes)$/i.test(String(input)) };
      case "dropdown":
        return { ok: definition.values.includes(input), value: input };
      case "date":
        return { ok: /^\d{4}-\d{2}-\d{2}$/.test(String(input)), value: String(input) };
      case "time":
        return { ok: /^\d{2}:\d{2}$/.test(String(input)), value: String(input) };
      default:
        return { ok: true, value: String(input ?? "") };
    }
  }

  write(row, col, input) {
    if (!Number.isInteger(row) || row < 0 || row >= this.rowCount ||
        !Number.isInteger(col) || col < 0 || col >= this.columns.length ||
        this.columns[col].nonEditable) return false;
    const next = this.coerce(col, input);
    if (!next.ok) return false;
    if (Object.is(this.get(row, col), next.value)) return true;
    this.overrides.set(this.key(row, col), next.value);
    this.edits.push({ kind: "cell", rowId: this.rowId(row),
      columnId: this.columns[col].columnId, value: next.value });
    return true;
  }

  rows(start = 0, end = this.rowCount) {
    const result = [];
    for (let r = start; r < Math.min(this.rowCount, end); r++) {
      const object = { __row: r };
      for (let c = 0; c < this.columns.length; c++)
        object[this.columns[c].columnId] = this.get(r, c);
      result.push(object);
    }
    return result;
  }
}
