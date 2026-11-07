/*
 * Reliable sparse-edit delivery protocol.
 *
 * A single ordered, durable outbox is the source of truth until a batch is
 * acknowledged. Retries use the same (datasetId, streamId, seq, edits); only
 * attempt changes so Dash observes each delivery attempt as a new property.
 * Server processing MUST be transactional, ordered and idempotent by key.
 */
import { blankRow, rowIndexesOf } from "./model.js";
import { isNumericRows } from "./numericData.js";

export const OUTBOX_VERSION = 1;
export const MAX_PENDING_BATCHES = 500;
export const MAX_OUTBOX_BYTES = 2_000_000;

export const outboxStorageKey = (componentId, datasetId) =>
  "dash-reactgrid:outbox:v1:" + JSON.stringify([componentId, datasetId]);

export const freshOutbox = (datasetId, streamId) => ({
  version: OUTBOX_VERSION, datasetId, streamId, nextSeq: 1,
  queue: [], blocked: null,
});

const validate = (value, datasetId) => {
  if (!value || value.version !== OUTBOX_VERSION || value.datasetId !== datasetId ||
      typeof value.streamId !== "string" || !value.streamId ||
      !Number.isSafeInteger(value.nextSeq) || value.nextSeq < 1 ||
      !Array.isArray(value.queue) || value.queue.length > MAX_PENDING_BATCHES ||
      (value.blocked !== null && typeof value.blocked !== "string")) {
    throw new Error("Saved edit outbox is invalid; refusing to overwrite pending changes");
  }
  let last = value.nextSeq - value.queue.length - 1;
  for (const batch of value.queue) {
    if (batch.datasetId !== datasetId || batch.streamId !== value.streamId ||
        !Number.isSafeInteger(batch.seq) || batch.seq !== ++last ||
        !Number.isSafeInteger(batch.attempt) || batch.attempt < 0 ||
        !Array.isArray(batch.edits) || !batch.edits.length) {
      throw new Error("Saved edit sequence is invalid; refusing to overwrite pending changes");
    }
  }
  if (last !== value.nextSeq - 1)
    throw new Error("Saved edit outbox sequence is inconsistent");
  if (new Set(value.queue.map((batch) => batch.seq)).size !== value.queue.length)
    throw new Error("Saved edit outbox contains duplicate sequence numbers");
  return value;
};

/** Saving first means a failed storage write cannot silently accept an edit. */
export const saveOutbox = (storage, key, outbox) => {
  const serialized = JSON.stringify(outbox);
  if (serialized.length > MAX_OUTBOX_BYTES)
    throw new Error("Pending edits exceed the browser storage limit; save or resolve earlier edits first");
  storage.setItem(key, serialized);
  return outbox;
};

export const loadOutbox = (storage, key, datasetId, newStreamId) => {
  const saved = storage.getItem(key);
  if (saved !== null) {
    if (saved.length > MAX_OUTBOX_BYTES)
      throw new Error("Saved edits exceed the supported outbox size");
    try {
      return validate(JSON.parse(saved), datasetId);
    } catch (error) {
      throw new Error("Cannot recover saved grid edits: " + error.message);
    }
  }
  return saveOutbox(storage, key, freshOutbox(datasetId, newStreamId()));
};

export const enqueueEdits = (outbox, edits) => {
  if (!edits.length) return outbox;
  if (outbox.blocked) throw new Error(outbox.blocked);
  if (outbox.queue.length >= MAX_PENDING_BATCHES)
    throw new Error("Too many unacknowledged edit batches; editing is paused");
  const batch = {
    datasetId: outbox.datasetId, streamId: outbox.streamId,
    seq: outbox.nextSeq, attempt: 0, edits,
  };
  return { ...outbox, nextSeq: outbox.nextSeq + 1, queue: [...outbox.queue, batch] };
};

export const retryHead = (outbox) => {
  if (outbox.blocked || !outbox.queue.length) return outbox;
  const [head, ...tail] = outbox.queue;
  return { ...outbox, queue: [{ ...head, attempt: head.attempt + 1 }, ...tail] };
};

export const acknowledgeEdits = (outbox, ack) => {
  if (!ack || !outbox.queue.length ||
      ack.datasetId !== outbox.datasetId ||
      ack.streamId !== outbox.streamId ||
      ack.seq !== outbox.queue[0].seq) return outbox;
  if (ack.status === "ok") {
    return { ...outbox, queue: outbox.queue.slice(1), blocked: null };
  }
  if (ack.status === "error" || ack.status === "conflict") {
    return {
      ...outbox,
      blocked: String(ack.message || ("Server rejected batch " + ack.seq)),
    };
  }
  return outbox;
};

/**
 * Restore all unacknowledged edits on a fresh authoritative snapshot.
 * Handles add operations already on the server (lost ACK), repeated deletes
 * and cell changes. Missing rows are a conflict, not a silent drop.
 */
export const replayPendingEdits = (table, queue, columns, newRow) => {
  if (!queue.length) return table;
  const columnIndex = new Map(columns.map((col, i) => [col.columnId, i]));
  let data = table.data;
  let rowIds = table.rowIds;
  let index = new Map(rowIndexesOf(rowIds));
  const ensureMutableData = () => {
    if (data === table.data) data = data.slice();
  };
  const ensureMutableIds = () => {
    if (rowIds === table.rowIds) rowIds = rowIds.slice();
  };
  const rebuildIndex = () => { index = new Map(rowIds.map((id, idx) => [id, idx])); };
  const copied = new Set();
  for (const batch of queue) {
    for (const edit of batch.edits) {
      if (edit.kind === "add") {
        if (index.has(edit.rowId)) continue;
        ensureMutableData();
        ensureMutableIds();
        data.push(blankRow(columns, newRow));
        rowIds.push(edit.rowId);
        copied.add(data.length - 1);
        index.set(edit.rowId, data.length - 1);
      } else if (edit.kind === "cell") {
        const row = index.get(edit.rowId);
        const col = columnIndex.get(edit.columnId);
        if (row === undefined || col === undefined)
          throw new Error("Pending edit refers to a missing row or column: " +
            String(edit.rowId) + "/" + String(edit.columnId));
        if (Object.is(data[row][col], edit.value)) continue;
        ensureMutableData();
        if (!copied.has(row)) {
          data[row] = data[row].slice();
          copied.add(row);
        }
        data[row][col] = edit.value;
      } else if (edit.kind === "remove") {
        if (!Array.isArray(edit.rowIds)) throw new Error("Invalid row removal event");
        const removed = new Set(edit.rowIds);
        if (![...removed].some((id) => index.has(id))) continue;
        ensureMutableData();
        ensureMutableIds();
        const keep = rowIds.map((id) => !removed.has(id));
        // NumericRows holds the original typed buffer and sparse overrides.
        // Remap its logical row indices without decoding every surviving row.
        data = isNumericRows(data)
          ? data.selectRows(keep)
          : data.filter((_, row) => keep[row]);
        rowIds = rowIds.filter((_, row) => keep[row]);
        copied.clear();
        rebuildIndex();
      } else {
        throw new Error("Unknown pending grid edit kind: " + String(edit.kind));
      }
    }
  }
  return { data, rowIds };
};
