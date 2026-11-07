"""Transactional, idempotent SQLite backend for DashReactGrid sparse edits.

Production pattern: use one durable database transaction to apply a batch and
record its (datasetId, streamId, seq, hash). An ACK is returned ONLY after
COMMIT. Retried deliveries cannot apply the same batch twice.

This reference store intentionally supports one authoritative row ordering
and last-writer-wins changes across different editor streams. For collaborative
editing, add per-row optimistic revisions or conflict detection.
"""
import hashlib
import json
import sqlite3
from pathlib import Path
from contextlib import closing


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def row_key(row_id):
    if not isinstance(row_id, (str, int)) or isinstance(row_id, bool):
        raise ValueError("rowId must be a string or integer")
    return canonical(row_id)


class SparseGridStore:
    def __init__(self, path, dataset_id, columns, new_row=None):
        self.path = str(Path(path))
        self.dataset_id = dataset_id
        self.columns = [c["columnId"] if isinstance(c, dict) else c for c in columns]
        if len(set(self.columns)) != len(self.columns):
            raise ValueError("column IDs must be unique")
        self.template = (
            [new_row.get(c) for c in self.columns] if isinstance(new_row, dict)
            else [new_row[i] if i < len(new_row) else None for i in range(len(self.columns))]
            if isinstance(new_row, list) else [None] * len(self.columns)
        )
        with closing(self.connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    dataset_id TEXT PRIMARY KEY,
                    columns_json TEXT NOT NULL,
                    template_json TEXT NOT NULL,
                    seeded INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS grid_rows (
                    dataset_id TEXT NOT NULL,
                    row_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    values_json TEXT NOT NULL,
                    PRIMARY KEY (dataset_id, row_id)
                );
                CREATE TABLE IF NOT EXISTS edit_streams (
                    dataset_id TEXT NOT NULL,
                    stream_id TEXT NOT NULL,
                    last_seq INTEGER NOT NULL,
                    PRIMARY KEY (dataset_id, stream_id)
                );
                CREATE INDEX IF NOT EXISTS idx_grid_rows_position
                    ON grid_rows(dataset_id, position);
                CREATE TABLE IF NOT EXISTS applied_batches (
                    dataset_id TEXT NOT NULL,
                    stream_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    digest TEXT NOT NULL,
                    PRIMARY KEY (dataset_id, stream_id, seq)
                );
            """)
            configured = db.execute(
                "SELECT columns_json, template_json FROM datasets WHERE dataset_id=?",
                (dataset_id,),
            ).fetchone()
            if configured:
                if configured != (canonical(self.columns), canonical(self.template)):
                    raise ValueError("The dataset's column configuration has changed")
            else:
                db.execute(
                    "INSERT INTO datasets(dataset_id,columns_json,template_json,seeded) VALUES(?,?,?,0)",
                    (dataset_id, canonical(self.columns), canonical(self.template)),
                )

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def seed_once(self, data, row_ids):
        """Initialise a NEW dataset. Never overwrite rows already persisted."""
        if len(data) != len(row_ids):
            raise ValueError("row IDs and values must have equal lengths")
        if any(len(row) != len(self.columns) for row in data):
            raise ValueError("Row width differs from the configured columns")
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")  # prevent concurrent first-time seeders
            seeded = db.execute(
                "SELECT seeded FROM datasets WHERE dataset_id=?",
                (self.dataset_id,),
            ).fetchone()
            if seeded is None:
                raise ValueError("Dataset is not configured")
            if seeded[0]:
                return
            db.executemany(
                "INSERT INTO grid_rows(dataset_id,row_id,position,values_json) VALUES(?,?,?,?)",
                [(self.dataset_id, row_key(rid), i, canonical(row))
                 for i, (rid, row) in enumerate(zip(row_ids, data))],
            )
            db.execute(
                "UPDATE datasets SET seeded=1 WHERE dataset_id=?",
                (self.dataset_id,),
            )

    def read(self):
        with closing(self.connect()) as db, db:
            rows = db.execute(
                "SELECT row_id, values_json FROM grid_rows WHERE dataset_id=? ORDER BY position",
                (self.dataset_id,),
            ).fetchall()
        return {
            "rowIds": [json.loads(row_id) for row_id, _ in rows],
            "data": [json.loads(values) for _, values in rows],
        }

    def row_count(self):
        """Number of rows in the authoritative table, without loading them."""
        with closing(self.connect()) as db:
            return db.execute(
                "SELECT COUNT(*) FROM grid_rows WHERE dataset_id=?",
                (self.dataset_id,),
            ).fetchone()[0]

    def read_range(self, start, end):
        """Load one bounded viewport by absolute row offset."""
        if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end < start:
            raise ValueError("Invalid requested row interval")
        if end - start > 1000:
            raise ValueError("Viewport request exceeds the configured safety limit")
        with closing(self.connect()) as db:
            rows = db.execute(
                """SELECT row_id, values_json FROM grid_rows
                   WHERE dataset_id=? ORDER BY position LIMIT ? OFFSET ?""",
                (self.dataset_id, end - start, start),
            ).fetchall()
        if len(rows) != end - start:
            raise ValueError("Viewport request extends past the end of the dataset")
        return {
            "rowIds": [json.loads(row_id) for row_id, _ in rows],
            "data": [json.loads(values) for _, values in rows],
        }

    def apply(self, event):
        """Return an ack suitable for Output('grid', 'editAck')."""
        if not isinstance(event, dict):
            return None
        dataset = event.get("datasetId")
        stream = event.get("streamId")
        seq = event.get("seq")
        ack = {"datasetId": dataset, "streamId": stream, "seq": seq}
        def reject(status, message):
            return {**ack, "status": status, "message": message}

        if dataset != self.dataset_id or not isinstance(stream, str) or not stream:
            return reject("conflict", "Unexpected dataset or stream identity")
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 1:
            return reject("conflict", "Invalid edit sequence number")
        edits = event.get("edits")
        if not isinstance(edits, list) or not edits:
            return reject("conflict", "No edits in batch")
        try:
            payload = canonical(edits)
            if len(payload) > 2_000_000:
                return reject("conflict", "Edit batch exceeds the maximum size")
            digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        except (TypeError, ValueError) as error:
            return reject("conflict", "Invalid edit payload: " + str(error))

        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT digest FROM applied_batches WHERE dataset_id=? AND stream_id=? AND seq=?",
                (dataset, stream, seq),
            ).fetchone()
            if prior:
                if prior[0] != digest:
                    db.rollback()
                    return reject("conflict", "A previously committed sequence has different edits")
                db.commit()
                return {**ack, "status": "ok"}
            last = db.execute(
                "SELECT last_seq FROM edit_streams WHERE dataset_id=? AND stream_id=?",
                (dataset, stream),
            ).fetchone()
            if seq != (last[0] if last else 0) + 1:
                db.rollback()
                return reject("conflict", "Out-of-order edit sequence")
            for edit in edits:
                self._apply_edit(db, edit)
            db.execute(
                "INSERT INTO applied_batches VALUES (?,?,?,?)",
                (dataset, stream, seq, digest),
            )
            db.execute(
                """INSERT INTO edit_streams VALUES (?,?,?)
                   ON CONFLICT(dataset_id, stream_id) DO UPDATE SET last_seq=excluded.last_seq""",
                (dataset, stream, seq),
            )
            db.commit()  # ACK only after the row edits and receipt are durable.
            return {**ack, "status": "ok"}
        except (ValueError, sqlite3.IntegrityError) as error:
            db.rollback()
            return reject("conflict", str(error))
        except sqlite3.OperationalError as error:
            db.rollback()
            return reject("retry", "Temporary database error: " + str(error))
        finally:
            db.close()

    def _apply_edit(self, db, edit):
        if not isinstance(edit, dict):
            raise ValueError("Invalid edit")
        kind = edit.get("kind")
        if kind == "add":
            rid = row_key(edit.get("rowId"))
            position = db.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM grid_rows WHERE dataset_id=?",
                (self.dataset_id,),
            ).fetchone()[0]
            db.execute(
                "INSERT INTO grid_rows VALUES (?,?,?,?)",
                (self.dataset_id, rid, position, canonical(self.template)),
            )
        elif kind == "cell":
            rid = row_key(edit.get("rowId"))
            column = edit.get("columnId")
            if column not in self.columns:
                raise ValueError("Unknown column")
            row = db.execute(
                "SELECT values_json FROM grid_rows WHERE dataset_id=? AND row_id=?",
                (self.dataset_id, rid),
            ).fetchone()
            if row is None:
                raise ValueError("Unknown row")
            if "value" not in edit:
                raise ValueError("Cell event is missing its value")
            values = json.loads(row[0])
            values[self.columns.index(column)] = edit["value"]
            db.execute(
                "UPDATE grid_rows SET values_json=? WHERE dataset_id=? AND row_id=?",
                (canonical(values), self.dataset_id, rid),
            )
        elif kind == "remove":
            ids = edit.get("rowIds")
            if not isinstance(ids, list) or not ids:
                raise ValueError("Empty row deletion")
            for rid in ids:
                db.execute(
                    "DELETE FROM grid_rows WHERE dataset_id=? AND row_id=?",
                    (self.dataset_id, row_key(rid)),
                )
        else:
            raise ValueError("Unknown edit kind")


# Example Dash callback, with 'grid' and the store created for the page:
#
# from dash import Input, Output, callback
#
# @callback(Output("grid", "editAck"),
#           Input("grid", "edits"), prevent_initial_call=True)
# def save_edits(batch):
#     return store.apply(batch)
#
# Do not use State("grid", "data"): that would transmit the full dataset.
# Each request must use a durable shared store, not a process-local dictionary.
