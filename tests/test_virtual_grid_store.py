"""Test server-backed grid operations, rollback, idempotency, undo/redo."""
import json
import tempfile
import unittest
from pathlib import Path

from tests.fixtures.sqlite_virtual_backend import VirtualGridStore


class Operations(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/"virtual.sqlite3"
        self.store=VirtualGridStore(self.path,"test",["name","value"],new_row={"value":0})
        self.store.seed_once([["Row "+str(i),i] for i in range(12)],["r"+str(i) for i in range(12)])

    def event(self,seq,*edits,attempt=1):
        return {"datasetId":"test","streamId":"browser-1","seq":seq,
                "attempt":attempt,"edits":list(edits)}

    def submit(self,seq,*edits):
        ack=self.store.apply(self.event(seq,*edits))
        self.assertEqual(ack["status"],"ok",ack)
        return ack

    def test_insert_at_absolute_position_and_reverse_via_undo_then_redo(self):
        op={"kind":"insert","rowId":"new-row","position":6,"values":["Inserted",99]}
        ack=self.submit(1,op)
        self.assertEqual(ack["rowCount"],13)
        self.assertEqual(self.store.read_range(5,8)["rowIds"],["r5","new-row","r6"])
        self.submit(2,{"kind":"undo","targetSeq":1})
        self.assertEqual(self.store.row_count(),12)
        self.assertEqual(self.store.read_range(5,7)["rowIds"],["r5","r6"])
        self.submit(3,{"kind":"undo","targetSeq":2})
        self.assertEqual(self.store.read_range(5,8)["rowIds"],["r5","new-row","r6"])

    def test_deletion_across_unloaded_rows_with_undo_redo(self):
        source=self.store.read()
        ack=self.submit(1,{"kind":"removeRange","start":3,"end":8})
        self.assertEqual(ack["rowCount"],7)
        self.assertEqual(self.store.read()["rowIds"],source["rowIds"][:3]+source["rowIds"][8:])
        self.submit(2,{"kind":"undo","targetSeq":1})
        self.assertEqual(self.store.read(),source)
        self.submit(3,{"kind":"undo","targetSeq":2})
        self.assertEqual(self.store.row_count(),7)

    def test_paste_across_unloaded_windows_and_undo_after_insert(self):
        edits={"kind":"paste","start":4,"columnIds":["name","value"],"rows":[
            ["edited4",44],["edited5",55],["edited6",66],["edited7",77],
        ]}
        self.submit(1,edits)
        self.assertEqual(self.store.read_range(4,8)["data"],
                         [["edited4",44],["edited5",55],["edited6",66],["edited7",77]])
        self.submit(2,{"kind":"insert","rowId":"shift","position":0,"values":["shifted",0]})
        self.submit(3,{"kind":"undo","targetSeq":1})
        self.assertEqual(self.store.read_range(5,9)["data"],
                         [["Row 4",4],["Row 5",5],["Row 6",6],["Row 7",7]])
        self.submit(4,{"kind":"undo","targetSeq":3})
        self.assertEqual(self.store.read_range(5,9)["data"],
                         [["edited4",44],["edited5",55],["edited6",66],["edited7",77]])

    def test_whole_column_fill_and_offscreen_copy_down_can_be_undone(self):
        # Larger than the old 1,000-row/20,000-cell expanded paste limit.
        path=Path(self.tmp.name)/"large-fill.sqlite3"
        store=VirtualGridStore(path,"large",["name","value"])
        store.seed_once([[f"Row {i}",i] for i in range(1500)],
                        [f"r{i}" for i in range(1500)])
        def apply(seq,operation):
            return store.apply({"datasetId":"large","streamId":"session",
                                "seq":seq,"edits":[operation]})
        filled={"kind":"fillRange","start":0,"end":1500,
                "columnIds":["value"],"values":[4.5]}
        self.assertEqual(apply(1,filled)["status"],"ok")
        self.assertEqual(store.read_range(1499,1500)["data"],[["Row 1499",4.5]])
        self.assertEqual(store.read_range(0,1)["data"],[["Row 0",4.5]])
        self.assertEqual(apply(2,{"kind":"undo","targetSeq":1})["status"],"ok")
        self.assertEqual(store.read_range(1499,1500)["data"],[["Row 1499",1499]])
        self.assertEqual(apply(3,{"kind":"undo","targetSeq":2})["status"],"ok")
        self.assertEqual(store.read_range(1000,1001)["data"],[["Row 1000",4.5]])

        # Source row 0 is not present in a viewport showing rows 500+.
        self.assertEqual(apply(4,{"kind":"fillDown","sourceRow":0,"start":1,
                                  "end":1500,"columnIds":["name"]})["status"],"ok")
        self.assertEqual(store.read_range(1499,1500)["data"],[["Row 0",4.5]])
        self.assertEqual(apply(5,{"kind":"undo","targetSeq":4})["status"],"ok")
        self.assertEqual(store.read_range(1499,1500)["data"],[["Row 1499",4.5]])

    def test_multi_window_multi_column_fill_preserves_reverse_undo_order(self):
        path=Path(self.tmp.name)/"multi-column-windows.sqlite3"
        store=VirtualGridStore(path,"multi-column-windows",
                               ["name","value"],
                               locked_cells=[["r255","value"]])
        original=[[f"Row {i}",i] for i in range(630)]
        store.seed_once(original,[f"r{i}" for i in range(630)])
        def apply(seq,op):
            return store.apply({"datasetId":"multi-column-windows",
                "streamId":"session","seq":seq,"edits":[op]})
        fill={"kind":"fillRange","start":0,"end":630,
              "columnIds":["name","value"],"values":["filled",99]}
        self.assertEqual(apply(1,fill)["status"],"ok")
        self.assertEqual(store.read_range(255,256)["data"],[["filled",255]])
        self.assertEqual(store.read_range(629,630)["data"],[["filled",99]])
        with store.connect() as db:
            raw=db.execute(
                "SELECT inverse_json FROM applied_batches "
                "WHERE dataset_id=? AND stream_id=? AND seq=?",
                ("multi-column-windows","session",1)).fetchone()[0]
        undo=json.loads(raw)[0]["edits"]
        self.assertEqual(len(undo),6)  # three 250-row windows, two columns
        self.assertEqual(undo[0]["columnIds"],["value"])
        self.assertEqual(undo[-1]["columnIds"],["name"])
        self.assertEqual(apply(2,{"kind":"undo","targetSeq":1})["status"],"ok")
        self.assertEqual(store.read()["data"],original)
        self.assertEqual(apply(3,{"kind":"undo","targetSeq":2})["status"],"ok")
        self.assertEqual(store.read_range(255,256)["data"],[["filled",255]])
        self.assertEqual(store.read_range(629,630)["data"],[["filled",99]])

    def test_bulk_fill_skips_only_protected_cells_and_undoes_exact_changes(self):
        path=Path(self.tmp.name)/"protected-fill.sqlite3"
        columns=[{"columnId":"type"},
                 {"columnId":"value","editableWhen":[{"columnId":"type",
                                                        "in":["open"]}]},
                 {"columnId":"constant","nonEditable":True}]
        store=VirtualGridStore(path,"protected-fill",columns,
                               locked_cells=[["b","value"]])
        original=[["open",1,"a"],["open",2,"b"],["closed",3,"c"]]
        store.seed_once(original,["a","b","c"])
        base={"datasetId":"protected-fill","streamId":"session"}
        def apply(seq,operation):
            return store.apply({**base,"seq":seq,"edits":[operation]})

        self.assertEqual(apply(1,{"kind":"fillRange","start":0,"end":3,
            "columnIds":["value"],"values":[99]})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["open",99,"a"],["open",2,"b"],["closed",3,"c"]])

        # A noneditable column and a locked cell must not suppress edits to
        # other selected columns in the same row. Conditional edit rules use
        # the original row values even when a sibling column is being changed.
        self.assertEqual(apply(2,{"kind":"fillRange","start":0,"end":3,
            "columnIds":["type","value","constant"],
            "values":["closed",77,"bad"]})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["closed",77,"a"],["closed",2,"b"],["closed",3,"c"]])

        # The inverse journal must contain only changed destinations. In
        # particular, undo must never overwrite b/value or c/value.
        with store.connect() as db:
            receipt=db.execute(
                "SELECT inverse_json FROM applied_batches "
                "WHERE dataset_id=? AND stream_id=? AND seq=?",
                ("protected-fill","session",2),
            ).fetchone()
        self.assertIsNotNone(receipt)
        inverse=json.loads(receipt[0])[0]["edits"]
        changed={op["columnIds"][0]:op["rowIds"] for op in inverse}
        self.assertEqual(changed,{"type":["a","b"],"value":["a"]})

        self.assertEqual(apply(3,{"kind":"undo","targetSeq":2})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["open",99,"a"],["open",2,"b"],["closed",3,"c"]])
        self.assertEqual(apply(4,{"kind":"undo","targetSeq":3})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["closed",77,"a"],["closed",2,"b"],["closed",3,"c"]])
        self.assertEqual(apply(5,{"kind":"undo","targetSeq":4})["status"],"ok")

        # Multi-column Ctrl+D gets values from the source row, but each
        # target cell still checks its own lock and original row rule.
        self.assertEqual(apply(6,{"kind":"fillDown","sourceRow":0,
            "start":1,"end":3,
            "columnIds":["type","value","constant"]})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["open",99,"a"],["open",2,"b"],["open",3,"c"]])
        self.assertEqual(apply(7,{"kind":"undo","targetSeq":6})["status"],"ok")
        self.assertEqual(store.read()["data"],
                         [["open",99,"a"],["open",2,"b"],["closed",3,"c"]])
        self.assertEqual(apply(8,{"kind":"undo","targetSeq":1})["status"],"ok")
        self.assertEqual(store.read()["data"],original)

    def test_bulk_fill_invalid_editability_rules_fail_atomically(self):
        path=Path(self.tmp.name)/"malformed-fill.sqlite3"
        store=VirtualGridStore(path,"malformed-fill",[
            {"columnId":"name"},
            {"columnId":"amount",
             "editableWhen":[
                 {"columnId":"name","in":["open"]},
                 {"columnId":"missing","truthy":True},
             ]},
        ])
        # The first edit rule rejects row A. The later invalid reference
        # must still fail the whole transaction instead of being hidden.
        source=[["A",1],["B",2]]
        store.seed_once(source,["a","b"])
        result=store.apply({"datasetId":"malformed-fill","streamId":"session",
            "seq":1,"edits":[{"kind":"fillRange","start":0,"end":2,
                "columnIds":["name","amount"],"values":["X",10]}]})
        self.assertEqual(result["status"],"conflict")
        self.assertEqual(store.read()["data"],source)

    def test_duplicate_lost_acks_dont_apply_structural_operation_twice(self):
        event=self.event(1,{"kind":"insert","rowId":"new","position":2,"values":["N",7]})
        first=self.store.apply(event)
        again=self.store.apply({**event,"attempt":4})
        self.assertEqual(first,again)
        self.assertEqual(self.store.row_count(),13)
        self.assertEqual(self.store.read()["rowIds"].count("new"),1)

    def test_transactional_rollback_if_later_operation_fails(self):
        ack=self.store.apply(self.event(1,
             {"kind":"insert","rowId":"new","position":2,"values":["N",5]},
             {"kind":"paste","start":11,"columnIds":["name"],"rows":[["1"],["2"],["3"]]}))
        self.assertEqual(ack["status"],"conflict")
        self.assertEqual(self.store.row_count(),12)
        self.assertNotIn("new",self.store.read()["rowIds"])
        self.assertEqual(self.store.apply(self.event(1,{"kind":"insert","rowId":"new",
                                            "position":2,"values":["N",5]}))["status"],"ok")

    def test_delete_one_row_and_redo_preserves_order(self):
        source=self.store.read()
        self.submit(1,{"kind":"remove","rowIds":["r1","r5","r9"]})
        self.assertEqual(self.store.row_count(),9)
        self.submit(2,{"kind":"undo","targetSeq":1})
        self.assertEqual(self.store.read(),source)
        self.submit(3,{"kind":"undo","targetSeq":2})
        self.assertEqual(self.store.row_count(),9)

    def test_server_row_window_uses_position_index(self):
        with self.store.connect() as db:
            plan=db.execute("""
                EXPLAIN QUERY PLAN SELECT row_id,values_json FROM grid_rows
                WHERE dataset_id=? AND position>=? AND position<?
                ORDER BY position
            """,("test",50000,50120)).fetchall()
        summary=" ".join(str(row) for row in plan)
        self.assertIn("idx_grid_rows_position",summary)
        # SQL range predicates allow direct index seeks at distant positions,
        # rather than scanning the first 50k rows with OFFSET.

    def test_large_range_limits_are_enforced(self):
        ack=self.store.apply(self.event(1,{"kind":"removeRange","start":0,"end":1001}))
        self.assertEqual(ack["status"],"conflict")
        ack=self.store.apply(self.event(1,{"kind":"paste","start":0,"columnIds":["name"],
                                        "rows":[["x"]]*1001}))
        self.assertEqual(ack["status"],"conflict")
        self.assertEqual(self.store.row_count(),12)

    def test_duplicate_request_payload_is_detected(self):
        self.submit(1,{"kind":"insert","rowId":"new","position":4,"values":["A",0]})
        duplicate=self.store.apply(self.event(1,{"kind":"insert","rowId":"different",
                                                "position":4,"values":["A",0]}))
        self.assertEqual(duplicate["status"],"conflict")

    def test_server_enforces_locks_and_dynamic_edit_rules(self):
        path=Path(self.tmp.name)/"protected.sqlite3"
        columns=[
            {"columnId":"type"},
            {"columnId":"value","editableWhen":[{"columnId":"type","in":["open"]}]},
            {"columnId":"locked","nonEditable":True},
        ]
        store=VirtualGridStore(path,"protected",columns)
        store.seed_once([["open",1,"x"],["closed",2,"y"]],["r0","r1"])
        base={"datasetId":"protected","streamId":"editor"}
        def submit(seq,ops):
            return store.apply({**base,"seq":seq,"edits":ops})
        rejected=submit(1,[{"kind":"paste","start":1,
                             "columnIds":["value"],"rows":[[5]]}])
        self.assertEqual(rejected["status"],"conflict")
        self.assertEqual(store.read_range(1,2)["data"],[["closed",2,"y"]])
        self.assertEqual(submit(1,[{"kind":"cell","rowId":"r0",
                                   "columnId":"locked","value":"BAD"}])["status"],"conflict")
        self.assertEqual(submit(1,[{"kind":"cell","rowId":"r0",
                                   "columnId":"value","value":99}])["status"],"ok")
        self.assertEqual(submit(2,[{"kind":"cell","rowId":"r0",
                                   "columnId":"type","value":"closed"}])["status"],"ok")
        # Undoing a historically valid edit is allowed even if a later edit
        # changed the row condition on which permission depends.
        self.assertEqual(submit(3,[{"kind":"undo","targetSeq":1}])["status"],"ok")
        self.assertEqual(store.read_range(0,1)["data"],[["closed",1,"x"]])

    def test_read_only_store_rejects_changes(self):
        store=VirtualGridStore(Path(self.tmp.name)/"readonly.sqlite3",
                               "read-only",[{"columnId":"x"}],read_only=True)
        store.seed_once([["original"]],["a"])
        ack=store.apply({"datasetId":"read-only","streamId":"editor",
                         "seq":1,"edits":[{"kind":"paste","start":0,
                           "columnIds":["x"],"rows":[["bad"]]}]})
        self.assertEqual(ack["status"],"conflict")
        self.assertEqual(store.read()["data"],[["original"]])

    def test_clipboard_reads_across_unloaded_windows_and_export(self):
        self.assertEqual(self.store.copy_range(3,6,0,2),
                         "Row 3\t3\nRow 4\t4\nRow 5\t5")
        output="".join(self.store.export_csv(3,6,0,2))
        self.assertEqual(output,"name,value\r\nRow 3,3\r\nRow 4,4\r\nRow 5,5\r\n")
        with self.assertRaisesRegex(ValueError,"outside"):
            self.store.copy_range(-1,12,0,2)

    def test_migration_from_preexisting_receipt_store(self):
        from tests.fixtures.sqlite_sparse_backend import SparseGridStore
        other=Path(self.tmp.name)/"migrate.sqlite3"
        orig=SparseGridStore(other,"migrate",["name","value"])
        orig.seed_once([["old",1]],["r1"])
        orig.apply({"datasetId":"migrate","streamId":"session","seq":1,
                    "edits":[{"kind":"cell","rowId":"r1","columnId":"value","value":2}]})
        again=VirtualGridStore(other,"migrate",["name","value"])
        self.assertEqual(again.row_count(),1)
        self.assertEqual(again.read()["data"],[["old",2]])

if __name__=="__main__":
    unittest.main()
