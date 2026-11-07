/*
 * Compact NumPy-backed data transport and copy-on-write rows.
 * Only requested rows become JavaScript arrays. Edits are retained as
 * overrides to the original typed buffer, even when hundreds of thousands
 * of rows are loaded. There is no per-cell object allocation on import.
 */
export const NUMPY_MARKER = "__dash_reactgrid_ndarray__";

const DTYPES = {
  float32: Float32Array, float64: Float64Array,
  int8: Int8Array, int16: Int16Array, int32: Int32Array,
  uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array,
  bool: Uint8Array,
};
const MAX_CELLS = 100_000_000;
const MAX_CACHED_ROWS = 1500;
const INDEX = /^(0|[1-9][0-9]*)$/;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export const isPackedNumericData = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  value[NUMPY_MARKER] === 1;

const rowProxy = {
  get(target, property, receiver) {
    if (typeof property === "string" && INDEX.test(property))
      return target.getRow(Number(property));
    return Reflect.get(target, property, receiver);
  },
  set(target, property, value, receiver) {
    if (typeof property === "string" && INDEX.test(property)) {
      target.setRow(Number(property), value);
      return true;
    }
    return Reflect.set(target, property, value, receiver);
  },
};

export const isNumericRows = (data) => data instanceof NumericRows;

export class NumericRows {
  constructor(values, rows, cols, dtype, overrides = new Map(),
              added = [], indices = null, cached = new Map()) {
    this.values = values;
    this.baseRows = rows;
    this.cols = cols;
    this.dtype = dtype;
    this.overrides = overrides;
    this.added = added;
    this.indices = indices;
    this.cached = cached;
    this.length = indices ? indices.length : rows + added.length;
    return new Proxy(this, rowProxy);
  }

  physical(row) {
    return this.indices ? this.indices[row] : row;
  }

  getRow(row) {
    if (!Number.isSafeInteger(row) || row < 0 || row >= this.length) return undefined;
    const physical = this.physical(row);
    if (this.overrides.has(physical)) return this.overrides.get(physical);
    if (physical >= this.baseRows) return this.added[physical - this.baseRows];
    if (this.cached.has(physical)) return this.cached.get(physical);
    const values = new Array(this.cols);
    const offset = physical * this.cols;
    for (let c = 0; c < this.cols; c++) {
      const value = this.values[offset + c];
      values[c] = this.dtype === "bool" ? Boolean(value) :
        Number.isFinite(value) ? value : null;
    }
    this.cached.set(physical, values);
    if (this.cached.size > MAX_CACHED_ROWS)
      this.cached.delete(this.cached.keys().next().value);
    return values;
  }

  setRow(row, value) {
    if (!Number.isSafeInteger(row) || row < 0 || row >= this.length ||
        !Array.isArray(value) || value.length !== this.cols)
      throw new RangeError("Invalid numeric grid row replacement");
    const physical = this.physical(row);
    // Appended rows need the same copy-on-write semantics as loaded rows.
    this.overrides.set(physical, value);
    this.cached.delete(physical);
  }

  clone() {
    return new NumericRows(this.values, this.baseRows, this.cols, this.dtype,
      new Map(this.overrides), this.added.slice(),
      this.indices ? this.indices.slice() : null, new Map(this.cached));
  }

  slice(start, end) {
    if (arguments.length === 0) return this.clone();
    const normalise = (n, fallback) => {
      if (n === undefined) return fallback;
      const i = Math.trunc(Number(n) || 0);
      return i < 0 ? Math.max(0, this.length + i) : Math.min(this.length, i);
    };
    const first = normalise(start, 0);
    const last = normalise(end, this.length);
    const result = [];
    for (let i = first; i < last; i++) result.push(this.getRow(i));
    return result;
  }

  at(index) {
    const i = Math.trunc(index);
    return this.getRow(i < 0 ? this.length + i : i);
  }

  push(value) {
    if (!Array.isArray(value) || value.length !== this.cols)
      throw new RangeError("Appended numeric grid row has invalid width");
    const physical = this.baseRows + this.added.length;
    this.added.push(value);
    if (this.indices) this.indices.push(physical);
    this.length += 1;
    return this.length;
  }

  // Used for a deletion: remap rows by index without decoding every cell.
  selectRows(keep) {
    const indices = [];
    for (let i = 0; i < this.length; i++) {
      if (keep[i]) indices.push(this.physical(i));
    }
    return new NumericRows(this.values, this.baseRows, this.cols, this.dtype,
      new Map(this.overrides), this.added.slice(), indices, new Map());
  }

  // Compatibility with existing optional row operations.
  map(fn) {
    return Array.from({ length: this.length }, (_, i) => fn(this.getRow(i), i, this));
  }
  filter(fn) {
    const selected = [];
    for (let i = 0; i < this.length; i++) {
      const row = this.getRow(i);
      if (fn(row, i, this)) selected.push(row);
    }
    return selected;
  }
  toArray() { return this.slice(0, this.length); }
  toJSON() { return this.toArray(); }
}

export const decodeGridData = (wire) => {
  if (!isPackedNumericData(wire)) return wire;
  const { dtype, shape, bdata } = wire;
  const Constructor = DTYPES[dtype];
  if (!Constructor || !Array.isArray(shape) || shape.length !== 2 ||
      !shape.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      shape[0] * shape[1] > MAX_CELLS || typeof bdata !== "string")
    throw new Error("Invalid binary grid dtype or shape");
  const required = shape[0] * shape[1] * Constructor.BYTES_PER_ELEMENT;
  if (bdata.length !== Math.ceil(required / 3) * 4)
    throw new Error("Binary grid payload size does not match shape");
  // atob returns a binary string; decode once, not for each displayed row.
  const binary = atob(bdata);
  if (binary.length !== required) throw new Error("Invalid binary grid data length");
  const raw = new Uint8Array(required);
  for (let i = 0; i < required; i++) raw[i] = binary.charCodeAt(i);
  // All supported platforms are little-endian in practice. Swap each word
  // on big-endian browsers so the declared little-endian wire format is stable.
  if (!littleEndian && Constructor.BYTES_PER_ELEMENT > 1) {
    const size = Constructor.BYTES_PER_ELEMENT;
    for (let i = 0; i < raw.length; i += size) {
      for (let j = 0; j < size / 2; j++) {
        const temp = raw[i + j];
        raw[i + j] = raw[i + size - j - 1];
        raw[i + size - j - 1] = temp;
      }
    }
  }
  return new NumericRows(new Constructor(raw.buffer), shape[0], shape[1], dtype);
};
