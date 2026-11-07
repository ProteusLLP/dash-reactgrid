"""Test server-backed grid operations, rollback, idempotency, undo/redo."""
import tempfile
import unittest
from pathlib import Path

from examples.virtual_grid_store import VirtualGridStore


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

    def test_clipboard_reads_across_unloaded_windows_and_export(self):
        self.assertEqual(self.store.copy_range(3,6,0,2),
                         "Row 3\t3\nRow 4\t4\nRow 5\t5")
        output="".join(self.store.export_csv(3,6,0,2))
        self.assertEqual(output,"name,value\r\nRow 3,3\r\nRow 4,4\r\nRow 5,5\r\n")
        with self.assertRaisesRegex(ValueError,"outside"):
            self.store.copy_range(-1,12,0,2)

    def test_migration_from_preexisting_receipt_store(self):
        from examples.sparse_edit_server import SparseGridStore
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
