/*
 * Pending edit overlay for server-fetched viewport data.
 *
 * The durable outbox stores edits by globally stable row ID. During scrolling
 * or recovery, a viewport can contain only a fraction of the full dataset:
 * apply matching cell edits and leave edits for unloaded rows in the outbox.
 */
export const overlayVirtualEdits = (page, queue, columns) => {
  if (!page || !queue?.length) return page;
  const rows = new Map(page.rowIds.map((id, i) => [id, i]));
  const cols = new Map(columns.map((col, i) => [col.columnId, i]));
  let data = page.data;
  const copied = new Set();
  for (const batch of queue) {
    for (const edit of batch.edits) {
      if (edit.kind === "paste" && Number.isSafeInteger(page.start)) {
        const colIndices = edit.columnIds.map((id) => cols.get(id));
        for (let j = 0; j < edit.rows.length; j++) {
          const ri = edit.start + j - page.start;
          if (ri < 0 || ri >= data.length) continue;
          if (colIndices.some((idx) => idx === undefined)) continue;
          if (data === page.data) data = data.slice();
          if (!copied.has(ri)) {
            data[ri] = data[ri].slice();
            copied.add(ri);
          }
          for (let k = 0; k < colIndices.length; k++)
            data[ri][colIndices[k]] = edit.rows[j][k];
        }
        continue;
      }
      if (edit.kind !== "cell") continue;
      const ri = rows.get(edit.rowId);
      const ci = cols.get(edit.columnId);
      if (ri === undefined || ci === undefined) continue;
      if (Object.is(data[ri][ci], edit.value)) continue;
      if (data === page.data) data = data.slice();
      if (!copied.has(ri)) {
        data[ri] = data[ri].slice();
        copied.add(ri);
      }
      data[ri][ci] = edit.value;
    }
  }
  return data === page.data ? page : { ...page, data };
};
