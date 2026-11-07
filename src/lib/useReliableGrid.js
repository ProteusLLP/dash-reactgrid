import { useEffect, useRef, useState } from "react";
import { editsPayload, initialGridSnapshot } from "./sparseEdits.js";
import {
  acknowledgeEdits, enqueueEdits, loadOutbox, outboxStorageKey,
  replayPendingEdits, retryHead, saveOutbox,
} from "./durableEdits.js";

const newStreamId = () => {
  if (typeof window === "undefined" || !window.crypto?.getRandomValues)
    throw new Error("Cryptographic random IDs are required for reliable sparse edits");
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Track the requested configuration independently of successful storage
// initialisation. A failure must remain stable across React renders.
const configurationIdentity = ({ id, datasetId }) =>
  JSON.stringify([id ?? null, datasetId ?? null]);

export const makeSession = ({ enabled, id, datasetId, data, rowIds, columns, newRow, windowed = false }) => {
  const identity = configurationIdentity({ id, datasetId });
  if (!enabled) return {
    identity, admissionError: null,
    enabled: false, sourceData: data, sourceRowIds: rowIds,
    sourceColumns: columns, sourceNewRow: newRow, windowed,
    table: initialGridSnapshot(data, rowIds, false).table,
    outbox: null, key: null, error: null,
  };
  const partial = {
    identity, admissionError: null,
    enabled: true, sourceData: data, sourceRowIds: rowIds,
    sourceColumns: columns, sourceNewRow: newRow, windowed,
    key: null, outbox: null, table: initialGridSnapshot(data, rowIds, true).table,
    error: null,
  };
  if (id === undefined || id === null || typeof datasetId !== "string" || !datasetId.trim() ||
      !Array.isArray(rowIds) || rowIds.length !== data.length ||
      rowIds.some((rowId) => rowId === null || rowId === undefined)) {
    return {
      ...partial, error: "Reliable sparse edits require id, a nonempty editDatasetId, and one stable rowId per data row.",
    };
  }
  try {
    const key = outboxStorageKey(id, datasetId);
    const storage = window.sessionStorage;
    const outbox = loadOutbox(storage, key, datasetId, newStreamId);
    return {
      ...partial, key, outbox,
      // Windowed mode does not have the full dataset locally. Pending
      // cell edits are overlaid on each loaded viewport instead.
      table: windowed ? partial.table :
        replayPendingEdits(partial.table, outbox.queue, columns, newRow),
    };
  } catch (error) {
    return { ...partial, error: "Cannot recover/persist pending grid edits: " + error.message };
  }
};

export const reconcileSession = (session, config) => {
  if (session.enabled !== config.enabled || session.windowed !== config.windowed ||
      session.identity !== configurationIdentity(config))
    return makeSession(config);
  if (session.sourceData === config.data && session.sourceRowIds === config.rowIds &&
      session.sourceColumns === config.columns && session.sourceNewRow === config.newRow)
    return session;
  // Only data/rowIds props replace the authoritative snapshot. Cosmetic
  // column changes and newRow defaults must not erase acknowledged edits
  // that the parent has not echoed back through data.
  const authoritative = session.sourceData !== config.data ||
    session.sourceRowIds !== config.rowIds;
  try {
    let table;
    if (!authoritative && config.enabled && !config.windowed) {
      const previousColumns = session.sourceColumns || [];
      const ids = new Map(previousColumns.map((column, index) => [column.columnId, index]));
      // When columns are rearranged, retain local values by column ID.
      // New columns take their defaults from the incoming data snapshot.
      const sameOrder = config.columns.length === previousColumns.length &&
        config.columns.every((column, index) => column.columnId === previousColumns[index].columnId);
      table = sameOrder ? session.table : {
        rowIds: session.table.rowIds,
        data: session.table.data.map((values, rowIndex) =>
          config.columns.map((column, columnIndex) => {
            const old = ids.get(column.columnId);
            return old === undefined ? config.data[rowIndex]?.[columnIndex] ?? null : values[old];
          })),
      };
    } else {
      const source = initialGridSnapshot(config.data, config.rowIds, config.enabled);
      table = config.enabled && session.outbox && !config.windowed
        ? replayPendingEdits(source.table, session.outbox.queue, config.columns, config.newRow)
        : source.table;
    }
    return {
      ...session, sourceData: config.data, sourceRowIds: config.rowIds,
      sourceColumns: config.columns, sourceNewRow: config.newRow, table,
    };
  } catch (error) {
    return { ...session, sourceData: config.data, sourceRowIds: config.rowIds,
      sourceColumns: config.columns, sourceNewRow: config.newRow,
      error: "Cannot reconcile server data with pending edits: " + error.message };
  }
};

/**
 * Delivery is strictly serial: only the head is ever sent to Dash. A
 * successful ack durably removes it before the next is sent. A timeout or
 * remount repeats that head with the same streamId and seq and a new attempt.
 */
export const useReliableGrid = ({
  enabled, id, datasetId, editAck, data, rowIds, columns, newRow, setProps,
  windowed = false,
}) => {
  const config = { enabled, id, datasetId, data, rowIds, columns, newRow, windowed };
  const [session, setSession] = useState(() => makeSession(config));
  const current = useRef(session);
  const fullSequence = useRef(0);
  const tableRef = useRef(session.table);
  const sendPropsRef = useRef(setProps);
  sendPropsRef.current = setProps;

  const synced = reconcileSession(current.current, config);
  if (synced !== current.current) {
    current.current = synced;
    tableRef.current = synced.table;
    setSession(synced);
  }
  const state = current.current;
  const key = state.key;

  const update = (next) => {
    current.current = next;
    tableRef.current = next.table;
    setSession(next);
  };

  const sendHead = () => {
    const before = current.current;
    if (!before.enabled || before.error || before.outbox?.blocked ||
        !before.outbox?.queue.length) return;
    try {
      const nextBox = retryHead(before.outbox);
      saveOutbox(window.sessionStorage, before.key, nextBox);
      update({ ...before, outbox: nextBox });
      sendPropsRef.current({ edits: nextBox.queue[0] });
    } catch (error) {
      update({ ...before, error: "Unable to save pending edits before retry: " + error.message });
    }
  };

  const publish = (next, tracked) => {
    if (!next.edits.length) return false;
    if (!enabled) {
      fullSequence.current += 1;
      sendPropsRef.current(editsPayload(next, fullSequence.current, false, tracked));
      return true;
    }
    const before = current.current;
    if (before.error || before.outbox?.blocked || !before.outbox || before.admissionError) return false;
    try {
      let queued = enqueueEdits(before.outbox, next.edits);
      // The first event is marked as an attempt before writing the durable
      // state. Later queued events are sent only when the head is ACKed.
      const shouldSend = before.outbox.queue.length === 0;
      if (shouldSend) queued = retryHead(queued);
      saveOutbox(window.sessionStorage, before.key, queued);
      update({
        ...before, outbox: queued, admissionError: null,
        table: windowed ? before.table : { data: next.data, rowIds: next.rowIds },
      });
      if (shouldSend) sendPropsRef.current({ edits: queued.queue[0] });
      // The committed batch identity is used by server-side undo/redo.
      return { seq: queued.nextSeq - 1, streamId: queued.streamId };
    } catch (error) {
      const message = error.message || String(error);
      // Admission backpressure does not invalidate the already-saved queue:
      // acknowledgements and retries must continue until it drains.
      const admissionOnly = message.includes("Too many unacknowledged edit batches") ||
        message.includes("Pending edits exceed the browser storage limit");
      update(admissionOnly ?
        { ...before, admissionError: "Edit was not accepted: " + message } :
        { ...before, error: "Edit was not accepted: " + message });
      return false;
    }
  };

  useEffect(() => {
    if (!enabled || !key) return;
    // Recover pending batches after a reload or mount, and retry every few
    // seconds until the server confirms a durable transaction.
    sendHead();
    const timer = window.setInterval(() => {
      if (window.navigator.onLine !== false) sendHead();
    }, 4000);
    window.addEventListener("online", sendHead);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", sendHead);
    };
  }, [enabled, key]);

  useEffect(() => {
    const before = current.current;
    if (!before.enabled || !before.outbox || before.error) return;
    const nextBox = acknowledgeEdits(before.outbox, editAck);
    if (nextBox === before.outbox) return;
    try {
      // If persistence fails, preserve the old pending head and retry it.
      saveOutbox(window.sessionStorage, before.key, nextBox);
      update({ ...before, outbox: nextBox,
        admissionError: nextBox.queue.length < 500 ? null : before.admissionError });
      if (!nextBox.blocked && nextBox.queue.length) sendHead();
    } catch (error) {
      update({ ...before, error: "Could not persist server acknowledgement: " + error.message });
    }
  }, [editAck, enabled, key]);

  // Warn when a user tries to close or navigate away while unacknowledged
  // edits are held only in this tab's sessionStorage. Not all browsers
  // display this dialog (notably mobile background kills).
  useEffect(() => {
    if (!enabled || !state.outbox?.queue.length) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled, state.outbox?.queue.length]);

  const retryFailed = () => {
    const before = current.current;
    if (!before.enabled || !before.key) return;
    try {
      const outbox = { ...before.outbox, blocked: null };
      saveOutbox(window.sessionStorage, before.key, outbox);
      update({ ...before, error: null, admissionError: null, outbox });
      sendHead();
    } catch (error) {
      update({ ...before, error: error.message });
    }
  };

  return {
    table: state.table, tableRef,
    publish, retryFailed, error: state.error || state.outbox?.blocked || state.admissionError || null,
    pending: state.outbox?.queue.length || 0,
    outbox: state.outbox,
  };
};
