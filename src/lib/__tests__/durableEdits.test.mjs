import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOX_VERSION, MAX_PENDING_BATCHES, outboxStorageKey,
  freshOutbox, saveOutbox, loadOutbox, enqueueEdits, retryHead,
  acknowledgeEdits, replayPendingEdits,
} from "../durableEdits.js";
import { rowIndexesOf } from "../model.js";

const columns = [
  { columnId: "name", type: "text" },
  { columnId: "value", type: "number" },
];
const source = {
  data: [["A", 1], ["B", 2]],
  rowIds: ["r1", "r2"],
};
const cell = (rowId, value) => [{kind: "cell", rowId, columnId: "value", value}];
const ack = (seq, status = "ok", message) =>
  ({datasetId: "pricing", streamId: "stream-123", seq, status, message});
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, v),
    removeItem: k => m.delete(k),
    get raw() { return m; },
  };
};
const initial = () => freshOutbox("pricing", "stream-123");

test("empty outbox persists and reloads its cryptographic stream identity and next sequence", () => {
  const storage = fakeStorage();
  const key = outboxStorageKey({ type: "grid", index: 2 }, "pricing");
  const a = loadOutbox(storage, key, "pricing", () => "stream-123");
  const b = loadOutbox(storage, key, "pricing", () => { throw Error("ID must be reused"); });
  assert.strictEqual(b.streamId, a.streamId);
  assert.equal(b.nextSeq, 1);
  assert.equal(b.version, OUTBOX_VERSION);
  assert.notEqual(key, outboxStorageKey({ type: "grid", index: 3 }, "pricing"));
  assert.notEqual(key, outboxStorageKey({ type: "grid", index: 2 }, "another-dataset"));
});

test("only first batch goes in flight; acknowledgements advance in strict FIFO order", () => {
  const a = enqueueEdits(initial(), cell("r1", 4));
  const b = enqueueEdits(a, cell("r2", 8));
  assert.deepEqual(b.queue.map(x => x.seq), [1, 2]);
  assert.equal(b.nextSeq, 3);
  assert.equal(acknowledgeEdits(b, ack(2)), b, "ACK for unsent batch 2 is ignored");
  const sent = retryHead(b);
  assert.equal(sent.queue[0].attempt, 1);
  assert.equal(sent.queue[1].attempt, 0);
  const afterFirst = acknowledgeEdits(sent, ack(1));
  assert.deepEqual(afterFirst.queue.map(x => x.seq), [2]);
  assert.equal(retryHead(afterFirst).queue[0].attempt, 1);
  assert.deepEqual(acknowledgeEdits(afterFirst, ack(1)), afterFirst, "stale ACK ignored");
  assert.equal(acknowledgeEdits(afterFirst, ack(2)).queue.length, 0);
});

test("retry preserves batch identity and payload, changes only attempt", () => {
  const original = enqueueEdits(initial(), cell("r1", 3));
  const sent = retryHead(original).queue[0];
  const retried = retryHead(retryHead(original)).queue[0];
  assert.equal(retried.attempt, 2);
  assert.deepEqual({ ...retried, attempt: 1 }, sent);
  assert.equal(sent.seq, 1);
  assert.equal(sent.streamId, "stream-123");
  assert.equal(sent.datasetId, "pricing");
});

test("acknowledgements require exact dataset, stream, seq and status", () => {
  const queue = enqueueEdits(initial(), cell("r1", 5));
  for (const other of [
    { ...ack(1), streamId: "elsewhere" },
    { ...ack(1), datasetId: "elsewhere" },
    ack(0), ack(2), ack(1, "retry"), { ...ack(1), status: "unknown" },
    null,
  ]) assert.strictEqual(acknowledgeEdits(queue, other), queue);
  assert.equal(acknowledgeEdits(queue, ack(1, "ok")).queue.length, 0);
});

test("server error or conflict blocks outstanding work without dropping batches", () => {
  const queue = enqueueEdits(initial(), cell("r1", 6));
  const blocked = acknowledgeEdits(queue, ack(1, "conflict", "row was removed"));
  assert.equal(blocked.blocked, "row was removed");
  assert.equal(blocked.queue.length, 1);
  assert.strictEqual(retryHead(blocked), blocked);
  assert.throws(() => enqueueEdits(blocked, cell("r2", 7)), /row was removed/);
  assert.equal(acknowledgeEdits(blocked, ack(1, "ok")).queue.length, 0);
});

test("save before transmission; quota failure cannot remove pending edits", () => {
  const key = "pending";
  const storage = fakeStorage();
  const a = enqueueEdits(initial(), cell("r1", 7));
  saveOutbox(storage, key, a);
  const failing = { getItem: storage.getItem, setItem: () => { throw Error("QuotaExceededError"); } };
  assert.throws(() => saveOutbox(failing, key, retryHead(a)), /QuotaExceeded/);
  assert.deepEqual(loadOutbox(storage, key, "pricing", () => "wrong"), a);
});

test("corrupted or mismatched persisted state refuses to overwrite pending changes", () => {
  const key = "pending";
  const storage = fakeStorage();
  storage.setItem(key, "{invalid json");
  assert.throws(() => loadOutbox(storage, key, "pricing", () => "new"), /Cannot recover/);
  assert.equal(storage.getItem(key), "{invalid json");
  storage.setItem(key, JSON.stringify(enqueueEdits(initial(), cell("r1", 3))));
  assert.throws(() => loadOutbox(storage, key, "another", () => "new"), /Cannot recover/);
  const sequence = enqueueEdits(initial(), cell("r1", 3));
  storage.setItem(key, JSON.stringify({ ...sequence, nextSeq: 123 }));
  assert.throws(() => loadOutbox(storage, key, "pricing", () => "new"), /sequence/);
});

test("pending-batch bound applies backpressure instead of dropping the queue", () => {
  let box = initial();
  for (let i = 0; i < MAX_PENDING_BATCHES; i++) box = enqueueEdits(box, cell("r1", i));
  assert.equal(box.queue.length, MAX_PENDING_BATCHES);
  assert.throws(() => enqueueEdits(box, cell("r2", 501)), /Too many/);
  assert.equal(box.queue[0].seq, 1);
  assert.equal(box.queue.at(-1).seq, MAX_PENDING_BATCHES);
});

test("restored pending batches replay in FIFO order and preserve untouched row references", () => {
  let box = initial();
  box = enqueueEdits(box, cell("r1", 7));
  box = enqueueEdits(box, cell("r1", 8));
  box = enqueueEdits(box, cell("r2", 9));
  const replayed = replayPendingEdits(source, box.queue, columns);
  assert.deepEqual(replayed.data, [["A", 8], ["B", 9]]);
  assert.deepEqual(source.data, [["A", 1], ["B", 2]]);
  assert.strictEqual(replayed.rowIds, source.rowIds, "no row IDs copied for a cell-only replay");
  assert.equal(rowIndexesOf(source.rowIds).has("new-row"), false);
});

test("ACK lost after a server row insert: replay does not create a duplicate", () => {
  let box = enqueueEdits(initial(), [
    {kind: "add", rowId: "new-row"},
    {kind: "cell", rowId: "new-row", columnId: "value", value: 10},
  ]);
  const first = replayPendingEdits(source, box.queue, columns, {name: "default"});
  assert.deepEqual(first.rowIds, ["r1", "r2", "new-row"]);
  assert.deepEqual(first.data.at(-1), ["default", 10]);
  const serverIncludesChange = { data: first.data, rowIds: first.rowIds };
  const again = replayPendingEdits(serverIncludesChange, box.queue, columns, {name: "default"});
  assert.deepEqual(again.rowIds, first.rowIds);
  assert.equal(again.data.length, 3);
  assert.equal(rowIndexesOf(source.rowIds).has("new-row"), false,
    "replay must not corrupt the model's cached index");
});

test("replay handles repeated deletes, and refuses missing rows for cell edits", () => {
  const box = enqueueEdits(initial(), [
    {kind: "remove", rowIds: ["r1"]},
  ]);
  const noOne = replayPendingEdits(source, box.queue, columns);
  assert.deepEqual(noOne.rowIds, ["r2"]);
  assert.deepEqual(replayPendingEdits(noOne, box.queue, columns).rowIds, ["r2"]);
  const bad = enqueueEdits(initial(), cell("missing", 5));
  assert.throws(() => replayPendingEdits(source, bad.queue, columns), /missing row or column/);
});

test("saved pending outbox survives a reload and retains sequence after ACK", () => {
  const storage = fakeStorage();
  const key = "durable-pricing";
  let box = loadOutbox(storage, key, "pricing", () => "stream-123");
  box = enqueueEdits(box, cell("r1", 50));
  saveOutbox(storage, key, box);
  const reloaded = loadOutbox(storage, key, "pricing", () => "unexpected");
  assert.deepEqual(reloaded, box);
  assert.equal(reloaded.queue[0].seq, 1);
  box = acknowledgeEdits(box, ack(1));
  saveOutbox(storage, key, box);
  const afterAck = loadOutbox(storage, key, "pricing", () => "unexpected");
  assert.equal(afterAck.nextSeq, 2);
  assert.equal(afterAck.queue.length, 0);
  assert.equal(enqueueEdits(afterAck, cell("r2", 5)).queue[0].seq, 2);
});
