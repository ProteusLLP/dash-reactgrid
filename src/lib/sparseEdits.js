/*
 * Sparse edit transmission for Dash.
 *
 * In sparse mode, the original `data` prop is an external snapshot. User
 * changes remain in the browser and only the small `edits` batch is published.
 * An externally supplied data or rowIds array replaces that local snapshot.
 * No React dependency, so the synchronisation and wire format can be tested.
 */
import { rowIdsOf } from "./model.js";
import { isNumericRows } from "./numericData.js";

/** Start with the server-supplied snapshot (without copying its rows). */
export const initialGridSnapshot = (data, rowIds, sparseEdits) => ({
  sourceData: data,
  sourceRowIds: rowIds,
  sparseEdits: Boolean(sparseEdits),
  table: { data, rowIds: rowIdsOf(data, rowIds) },
});

/** Reset only when the source dataset, row IDs, or transmission mode changes. */
export const reconcileGridSnapshot = (snapshot, data, rowIds, sparseEdits) =>
  snapshot.sourceData === data &&
  snapshot.sourceRowIds === rowIds &&
  snapshot.sparseEdits === Boolean(sparseEdits)
    ? snapshot
    : initialGridSnapshot(data, rowIds, sparseEdits);

/** Preserve the original server source while advancing the browser's table. */
export const commitGridSnapshot = (snapshot, next) => ({
  ...snapshot,
  table: { data: next.data, rowIds: next.rowIds },
});

/** The payload sent through Dash's setProps; no bulk data in sparse mode. */
export const editsPayload = (next, seq, sparseEdits, hasRowIds) => {
  if (!next.edits.length) return null;
  const update = { edits: { seq, edits: next.edits } };
  if (!sparseEdits) {
    update.data = isNumericRows(next.data) ? next.data.toArray() : next.data;
    if (hasRowIds) update.rowIds = next.rowIds;
  }
  return update;
};
