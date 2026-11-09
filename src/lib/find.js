/**
 * Spreadsheet find, independent of the number of ReactGrid DOM rows.
 * Search visible columns in row-major order, starting after the cursor,
 * wrapping at most once. Do not build a list of all matching cells.
 */
export const searchableText = (value, column) => {
  if (value == null) return "";
  if (column?.type === "dropdown") {
    const option = (column.values || []).find((entry) =>
      String(typeof entry === "object" && entry !== null ? entry.value : entry) === String(value));
    if (option !== undefined && typeof option === "object" && option !== null)
      return String(option.label ?? option.value ?? value) + "\n" + String(value);
  }
  return String(value);
};

export const cellMatches = (value, column, query, caseSensitive = false) => {
  if (!query) return false;
  const haystack = searchableText(value, column);
  return caseSensitive ? haystack.includes(query) :
    haystack.toLowerCase().includes(query.toLowerCase());
};

export const findNextCell = (data, allColumns, visibleColumns, query,
  startRow = -1, startColumn = -1, direction = 1, caseSensitive = false) => {
  const height = data.length, width = visibleColumns.length;
  if (!query || !height || !width) return null;
  const indices = new Map(allColumns.map((col, i) => [col.columnId, i]));
  const total = height * width;
  const start = startRow < 0 ? (direction === -1 ? 0 : -1) :
    startRow * width + startColumn;
  for (let offset = 1; offset <= total; offset++) {
    const index = ((start + direction * offset) % total + total) % total;
    const row = Math.floor(index / width), col = index % width;
    const descriptor = visibleColumns[col];
    const sourceIndex = indices.get(descriptor.columnId);
    if (sourceIndex !== undefined &&
        cellMatches(data[row][sourceIndex], descriptor, query, caseSensitive))
      return {row, col, columnId:descriptor.columnId};
  }
  return null;
};

export const matchesFindResponse = (response, pending) =>
  Boolean(response && pending && response.datasetId === pending.datasetId &&
    response.requestId === pending.requestId &&
    response.query === pending.query);

/** Find cursors retain a stable column ID when visible columns are reconfigured. */
export const resolveFindCursor = (cursor, visibleColumns) => {
  if (!cursor || !Number.isSafeInteger(cursor.row) || cursor.row < 0) return null;
  const col = visibleColumns.findIndex((column) => column.columnId === cursor.columnId);
  return col < 0 ? null : {row:cursor.row, col};
};
