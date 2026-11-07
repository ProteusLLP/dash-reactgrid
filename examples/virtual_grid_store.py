"""Server-side range operations with transactional undo for a virtual Dash grid.

Extends the idempotent receipt protocol with ordered insert/delete/paste/undo
operations. Inverse edit descriptions are saved in the SAME SQLite transaction
as row mutations. This intentionally supports single-editor semantics.
"""
import csv
import io
import json
import sqlite3
from contextlib import closing

from examples.sparse_edit_server import SparseGridStore, canonical, row_key

MAX_BATCH_ROWS = 1000
MAX_PASTE_CELLS = 20000
MAX_COPY_BYTES = 1_000_000


class VirtualGridStore(SparseGridStore):
    def __init__(self, path, dataset_id, columns, new_row=None,
                 read_only=False, locked_cells=None):
        self.read_only = bool(read_only)
        self.column_definitions = {
            c["columnId"]: c for c in columns if isinstance(c, dict)
        }
        self.locked_cells = {
            (row_key(row_id), col_id) for row_id,col_id in (locked_cells or [])
        }
        super().__init__(path, dataset_id, columns, new_row)
        with closing(self.connect()) as db, db:
            names = {x[1] for x in db.execute("PRAGMA table_info(applied_batches)")}
            if "inverse_json" not in names:
                db.execute("ALTER TABLE applied_batches ADD COLUMN inverse_json TEXT")
            names = {x[1] for x in db.execute("PRAGMA table_info(datasets)")}
            if "revision" not in names:
                db.execute("ALTER TABLE datasets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")

    def revision(self):
        with closing(self.connect()) as db:
            return db.execute(
                "SELECT revision FROM datasets WHERE dataset_id=?", (self.dataset_id,)
            ).fetchone()[0]

    def _assert_can_edit(self, row_id, columns, current_values):
        if self.read_only:
            raise ValueError("The dataset is read-only")
        for column_id in columns:
            meta=self.column_definitions.get(column_id, {})
            if meta.get("nonEditable") or (row_key(row_id),column_id) in self.locked_cells:
                raise ValueError("A selected cell is locked: " + str(column_id))
            for rule in meta.get("editableWhen", []):
                if rule.get("columnId") not in self.columns:
                    raise ValueError("Invalid editableWhen column")
                value=current_values[self.columns.index(rule["columnId"])]
                if "in" in rule and value not in rule["in"]:
                    raise ValueError("Cell edit rules reject the selected row")
                if "truthy" in rule and bool(value)!=rule["truthy"]:
                    raise ValueError("Cell edit rules reject the selected row")

    def _count(self, db):
        return db.execute("SELECT COUNT(*) FROM grid_rows WHERE dataset_id=?",
                          (self.dataset_id,)).fetchone()[0]

    def _ordered(self, db, start, end):
        return db.execute(
            """SELECT row_id, position, values_json FROM grid_rows
               WHERE dataset_id=? AND position>=? AND position<?
               ORDER BY position""",
            (self.dataset_id, start, end),
        ).fetchall()

    def _insert(self, db, row_id, position, values):
        row_id = row_key(row_id)
        if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position <= self._count(db):
            raise ValueError("Row insertion is outside the dataset")
        if self.read_only:
            raise ValueError("The dataset is read-only")
        if not isinstance(values, list) or len(values) != len(self.columns):
            raise ValueError("Inserted row has the wrong number of values")
        # Unique row IDs are enforced by the database primary key.
        db.execute("UPDATE grid_rows SET position=position+1 WHERE dataset_id=? AND position>=?",
                   (self.dataset_id, position))
        db.execute("INSERT INTO grid_rows VALUES(?,?,?,?)",
                   (self.dataset_id, row_id, position, canonical(values)))
        return {"kind":"remove", "rowIds":[json.loads(row_id)]}

    def _remove(self, db, ids):
        if self.read_only:
            raise ValueError("The dataset is read-only")
        if not isinstance(ids,list) or not ids or len(ids)>MAX_BATCH_ROWS:
            raise ValueError("Row deletion exceeds the permitted batch size")
        unique=list(dict.fromkeys(row_key(x) for x in ids))
        records=[]
        for rid in unique:
            row=db.execute(
                "SELECT position,values_json FROM grid_rows WHERE dataset_id=? AND row_id=?",
                (self.dataset_id,rid),
            ).fetchone()
            if row is None:
                raise ValueError("Row to delete does not exist")
            records.append({"rowId":json.loads(rid),"position":row[0],"values":json.loads(row[1])})
        db.executemany(
            "DELETE FROM grid_rows WHERE dataset_id=? AND row_id=?",
            [(self.dataset_id,rid) for rid in unique],
        )
        # Renumber remaining rows in one window query, not one UPDATE per
        # deleted position. The index keeps window requests efficient.
        db.execute("""
            WITH numbered AS (
                SELECT row_id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS pos
                FROM grid_rows WHERE dataset_id=?
            )
            UPDATE grid_rows
            SET position=(SELECT pos FROM numbered WHERE numbered.row_id=grid_rows.row_id)
            WHERE dataset_id=?
        """,(self.dataset_id,self.dataset_id))
        records.sort(key=lambda x:x["position"])
        return {"kind":"restore","rows":records}

    def _restore(self, db, rows):
        if not isinstance(rows,list) or not rows or len(rows)>MAX_BATCH_ROWS:
            raise ValueError("Invalid restoration batch")
        removing=[]
        for row in sorted(rows,key=lambda x:x["position"]):
            self._insert(db,row["rowId"],row["position"],row["values"])
            removing.append(row["rowId"])
        return {"kind":"remove","rowIds":removing}

    def _paste(self, db, edit, internal=False):
        start=edit.get("start")
        cols=edit.get("columnIds")
        data=edit.get("rows")
        if not isinstance(start,int) or isinstance(start,bool) or start<0:
            raise ValueError("Invalid paste start")
        if not isinstance(cols,list) or not cols or len(cols)!=len(set(cols)) or any(c not in self.columns for c in cols):
            raise ValueError("Paste columns are invalid")
        if not isinstance(data,list) or not data or len(data)>MAX_BATCH_ROWS or len(cols)*len(data)>MAX_PASTE_CELLS:
            raise ValueError("Paste exceeds the configured batch limits")
        if any(not isinstance(row,list) or len(row)!=len(cols) for row in data):
            raise ValueError("Paste rows have inconsistent width")
        entries=self._ordered(db,start,start+len(data))
        if len(entries)!=len(data):
            raise ValueError("Paste extends past the dataset; insert rows first")
        indexes=[self.columns.index(c) for c in cols]
        previous=[]
        updates=[]
        for (row_id,position,values_json),new_values in zip(entries,data):
            values=json.loads(values_json)
            if not internal:
                self._assert_can_edit(json.loads(row_id),cols,values)
            previous.append([values[i] for i in indexes])
            for i,v in zip(indexes,new_values):
                values[i]=v
            updates.append((canonical(values),self.dataset_id,row_id))
        db.executemany(
            "UPDATE grid_rows SET values_json=? WHERE dataset_id=? AND row_id=?",
            updates,
        )
        # Inverse references stable row IDs, so it remains correct even if
        # subsequent structural changes shift absolute row positions.
        return {"kind":"setRows","rowIds":[json.loads(row[0]) for row in entries],
                "columnIds":cols,"rows":previous}

    def _set_rows(self, db, edit, internal=False):
        ids=edit.get("rowIds")
        cols=edit.get("columnIds")
        values=edit.get("rows")
        if not isinstance(ids,list) or not ids or len(ids)>MAX_BATCH_ROWS or not isinstance(cols,list) or len(set(cols))!=len(cols) or any(c not in self.columns for c in cols) or not isinstance(values,list) or len(values)!=len(ids):
            raise ValueError("Invalid row-value update")
        if any(not isinstance(x,list) or len(x)!=len(cols) for x in values):
            raise ValueError("Invalid row-value update width")
        indexes=[self.columns.index(c) for c in cols]
        before=[]
        updates=[]
        for rid,updated in zip(ids,values):
            key=row_key(rid)
            current=db.execute("SELECT values_json FROM grid_rows WHERE dataset_id=? AND row_id=?",
                               (self.dataset_id,key)).fetchone()
            if current is None:raise ValueError("An edited row has been deleted")
            data=json.loads(current[0])
            if not internal:
                self._assert_can_edit(rid,cols,data)
            before.append([data[i] for i in indexes])
            for i,v in zip(indexes,updated):data[i]=v
            updates.append((canonical(data),self.dataset_id,key))
        db.executemany("UPDATE grid_rows SET values_json=? WHERE dataset_id=? AND row_id=?",updates)
        return {"kind":"setRows","rowIds":ids,"columnIds":cols,"rows":before}

    def _operation(self, db, op, stream, current_seq, internal=False):
        if not isinstance(op,dict):raise ValueError("Edit must be an object")
        kind=op.get("kind")
        if kind=="insert":
            return self._insert(db,op.get("rowId"),op.get("position"),op.get("values",self.template))
        if kind=="add":
            return self._insert(db,op.get("rowId"),self._count(db),self.template)
        if kind=="remove":
            return self._remove(db,op.get("rowIds"))
        if kind=="removeRange":
            start,end=op.get("start"),op.get("end")
            if not isinstance(start,int) or not isinstance(end,int) or isinstance(start,bool) or isinstance(end,bool) or end<=start or end-start>MAX_BATCH_ROWS:
                raise ValueError("Invalid deletion interval")
            entries=self._ordered(db,start,end)
            if len(entries)!=end-start:raise ValueError("Deletion is outside the dataset")
            return self._remove(db,[json.loads(row[0]) for row in entries])
        if kind=="paste":
            return self._paste(db,op,internal=internal)
        if kind=="setRows":
            return self._set_rows(db,op,internal=internal)
        if kind=="cell":
            return self._set_rows(db,{"rowIds":[op.get("rowId")],
                "columnIds":[op.get("columnId")],"rows":[[op["value"]]]},internal=internal)
        if kind=="restore":
            return self._restore(db,op.get("rows"))
        if kind=="undo":
            target=op.get("targetSeq")
            if not isinstance(target,int) or isinstance(target,bool) or target<=0 or target>=current_seq:
                raise ValueError("Undo references an invalid sequence")
            receipt=db.execute(
                "SELECT inverse_json FROM applied_batches WHERE dataset_id=? AND stream_id=? AND seq=?",
                (self.dataset_id,stream,target),
            ).fetchone()
            if not receipt or receipt[0] is None:
                raise ValueError("Cannot undo an unknown operation")
            inverse=json.loads(receipt[0])
            # Execute inverse operations in order. To undo an undo, the inverse
            # of this sequence is saved as a new receipt.
            actions=[]
            for child in inverse:
                actions.insert(0,self._operation(db,child,stream,current_seq,internal=True))
            return {"kind":"sequence","edits":actions}
        if kind=="sequence":
            actions=[]
            for child in op["edits"]:
                actions.insert(0,self._operation(db,child,stream,current_seq))
            return {"kind":"sequence","edits":actions}
        raise ValueError("Unsupported edit kind: "+str(kind))

    def apply(self,event):
        if not isinstance(event,dict):return None
        dataset,stream,seq=event.get("datasetId"),event.get("streamId"),event.get("seq")
        ack={"datasetId":dataset,"streamId":stream,"seq":seq}
        def reject(status,message):return {**ack,"status":status,"message":message}
        if dataset!=self.dataset_id or not isinstance(stream,str) or not stream:
            return reject("conflict","Unknown dataset or stream")
        if not isinstance(seq,int) or isinstance(seq,bool) or seq<1:
            return reject("conflict","Invalid sequence number")
        edits=event.get("edits")
        if not isinstance(edits,list) or not edits:
            return reject("conflict","No edits")
        try:
            payload=canonical(edits)
            if len(payload.encode("utf-8"))>2_000_000:
                return reject("conflict","Edit batch exceeds maximum bytes")
            digest=__import__("hashlib").sha256(payload.encode("utf-8")).hexdigest()
        except (ValueError,TypeError) as e:
            return reject("conflict",str(e))
        with closing(self.connect()) as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                existing=db.execute(
                    "SELECT digest FROM applied_batches WHERE dataset_id=? AND stream_id=? AND seq=?",
                    (dataset,stream,seq),
                ).fetchone()
                if existing:
                    if existing[0]!=digest:
                        db.rollback()
                        return reject("conflict","Retried sequence has a different payload")
                    revision=db.execute("SELECT revision FROM datasets WHERE dataset_id=?",
                                        (dataset,)).fetchone()[0]
                    count=self._count(db)
                    db.commit()
                    return {**ack,"status":"ok","rowCount":count,"revision":revision}
                last=db.execute(
                    "SELECT last_seq FROM edit_streams WHERE dataset_id=? AND stream_id=?",
                    (dataset,stream),
                ).fetchone()
                if seq!=(last[0] if last else 0)+1:
                    db.rollback()
                    return reject("conflict","Out-of-order sequence")
                inverse=[]
                for op in edits:
                    inverse.insert(0,self._operation(db,op,stream,seq))
                db.execute(
                    "INSERT INTO applied_batches(dataset_id,stream_id,seq,digest,inverse_json) VALUES(?,?,?,?,?)",
                    (dataset,stream,seq,digest,canonical(inverse)),
                )
                db.execute(
                    """INSERT INTO edit_streams VALUES (?,?,?)
                       ON CONFLICT(dataset_id,stream_id) DO UPDATE SET last_seq=excluded.last_seq""",
                    (dataset,stream,seq),
                )
                db.execute("UPDATE datasets SET revision=revision+1 WHERE dataset_id=?",(dataset,))
                revision=db.execute("SELECT revision FROM datasets WHERE dataset_id=?",
                                    (dataset,)).fetchone()[0]
                count=self._count(db)
                db.commit()
                return {**ack,"status":"ok","rowCount":count,"revision":revision}
            except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as e:
                db.rollback()
                return reject("conflict",str(e))
            except sqlite3.OperationalError as e:
                db.rollback()
                return reject("retry",str(e))

    def copy_range(self,start,end,column_start,column_end):
        """Read a bounded TSV range; large exports should stream CSV instead."""
        if not all(isinstance(x,int) and not isinstance(x,bool) for x in (start,end,column_start,column_end)):
            raise ValueError("Invalid clipboard range")
        if not(0<=start<end<=self.row_count() and 0<=column_start<column_end<=len(self.columns)):
            raise ValueError("Clipboard range outside the dataset")
        if end-start>MAX_BATCH_ROWS:
            raise ValueError("Clipboard range too large; use the CSV download")
        buf=io.StringIO()
        writer=csv.writer(buf,delimiter="\t",lineterminator="\n")
        for pos in range(start,end,250):
            window=self.read_range(pos,min(end,pos+250))
            for data in window["data"]:
                writer.writerow(["" if val is None else str(val) for val in data[column_start:column_end]])
                if buf.tell()>MAX_COPY_BYTES:
                    raise ValueError("Clipboard text exceeds 1 MB; use CSV download")
        return buf.getvalue().rstrip("\n")

    def export_csv(self,start,end,column_start,column_end):
        """Iterate CSV chunks without holding all selected rows in RAM."""
        if not all(isinstance(x,int) for x in (start,end,column_start,column_end)) or not (
            0<=start<end<=self.row_count() and 0<=column_start<column_end<=len(self.columns)
        ):
            raise ValueError("Invalid export range")
        first=io.StringIO()
        writer=csv.writer(first)
        writer.writerow(self.columns[column_start:column_end])
        yield first.getvalue()
        for pos in range(start,end,250):
            buff=io.StringIO()
            writer=csv.writer(buff)
            window=self.read_range(pos,min(end,pos+250))
            for row in window["data"]:
                writer.writerow(row[column_start:column_end])
            yield buff.getvalue()
