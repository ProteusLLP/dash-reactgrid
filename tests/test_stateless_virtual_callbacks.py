"""The virtual-row protocol uses injected functions, never managed storage."""
import csv
import io
import unittest

import importlib.util
from pathlib import Path

# Keep the pure adapter test runnable before Dash browser dependencies are
# installed; loading the package itself would import Dash unnecessarily.
spec = importlib.util.spec_from_file_location(
    "stateless_virtual", Path(__file__).resolve().parents[1] /
    "dash_reactgrid" / "stateless_virtual.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
window_response = module.window_response
clipboard_response = module.clipboard_response
csv_chunks = module.csv_chunks
edit_ack = module.edit_ack


class StatelessVirtualCallbacksTests(unittest.TestCase):
    columns = [{"columnId":"name"}, {"columnId":"amount"}]
    count = 100_000

    @staticmethod
    def source(start,end):
        return {"rowIds":[f"id-{i}" for i in range(start,end)],
                "data":[[f"Row {i}",i] for i in range(start,end)]}

    def test_far_window_fetch_is_bounded_and_stateless(self):
        calls=[]
        def fetch(start,end):
            calls.append((start,end))
            return self.source(start,end)
        req={"datasetId":"sample","requestId":91,"start":50000,"end":50120}
        reply=window_response(req,dataset_id="sample",row_count=self.count,
                              columns=self.columns,fetch_rows=fetch)
        self.assertEqual(calls,[(50000,50120)])
        self.assertEqual(reply["rowIds"][0],"id-50000")
        self.assertEqual(reply["data"][-1],["Row 50119",50119])
        self.assertEqual(reply["requestId"],91)
        self.assertEqual(reply["datasetId"],"sample")
        self.assertEqual(len(reply["data"]),120)
        self.assertEqual(window_response(req,dataset_id="sample",row_count=self.count,
                                        columns=self.columns,fetch_rows=fetch),reply)

    def test_data_only_provider_does_not_transmit_implicit_row_ids(self):
        request={"datasetId":"sample","requestId":2,
                 "start":99900,"end":99902}
        answer=window_response(request,dataset_id="sample",row_count=self.count,
            columns=self.columns,fetch_rows=lambda a,b:
            {"data":[[f"Row {i}",i] for i in range(a,b)]})
        self.assertNotIn("rowIds",answer)
        self.assertEqual(answer["data"],[["Row 99900",99900],
                                         ["Row 99901",99901]])
        bare=window_response(request,dataset_id="sample",row_count=self.count,
            columns=self.columns,fetch_rows=lambda a,b:
            [[f"Row {i}",i] for i in range(a,b)])
        self.assertEqual(bare,answer)
        clipboard=clipboard_response({**request,"columnStart":0,"columnEnd":2},
            dataset_id="sample",row_count=self.count,columns=self.columns,
            fetch_rows=lambda a,b:{"data":[[f"Row {i}",i] for i in range(a,b)]})
        self.assertEqual(clipboard["text"],"Row 99900\t99900\nRow 99901\t99901")

    def test_rejects_invalid_windows_before_calling_the_provider(self):
        requested=[]
        def fetch(a,b):
            requested.append((a,b))
            return self.source(a,b)
        for req in [
            {"datasetId":"other","start":0,"end":5},
            {"datasetId":"sample","start":0,"end":0},
            {"datasetId":"sample","start":0,"end":2000},
            {"datasetId":"sample","start":-1,"end":10},
            {"datasetId":"sample","start":100000,"end":100001},
            {"datasetId":"sample","start":False,"end":10},
        ]:
            with self.subTest(req=req), self.assertRaises(ValueError):
                window_response(req,dataset_id="sample",row_count=self.count,
                                columns=self.columns,fetch_rows=fetch)
        self.assertFalse(requested)

    def test_rejects_broken_data_providers(self):
        req={"datasetId":"a","requestId":1,"start":0,"end":2}
        invalid=[
            {"data":[["x",1]],"rowIds":["a"]},
            {"data":[["x",1],["y",2]],"rowIds":["same","same"]},
            {"data":[["x"],["y",2]],"rowIds":["r1","r2"]},
            {"data":[["x",1],["y",2]],"rowIds":[None,"r2"]},
            {"data":[["x",1],["y",2]],"rowIds":None},
        ]
        for result in invalid:
            with self.subTest(result=result),self.assertRaises(ValueError):
                window_response(req,dataset_id="a",row_count=2,
                                columns=self.columns,fetch_rows=lambda a,b:result)

    def test_clipboard_and_csv_use_only_requested_ranges(self):
        calls=[]
        def fetch(start,end):
            calls.append((start,end))
            return self.source(start,end)
        request={"datasetId":"a","requestId":7,"start":500,"end":503,
                 "columnStart":0,"columnEnd":2}
        reply=clipboard_response(request,dataset_id="a",row_count=self.count,
                                 columns=self.columns,fetch_rows=fetch)
        self.assertEqual(reply["text"],"Row 500\t500\nRow 501\t501\nRow 502\t502")
        chunks=csv_chunks(start=500,end=1200,column_start=0,column_end=2,
                          row_count=self.count,columns=self.columns,fetch_rows=fetch)
        csv_text="".join(chunks)
        parsed=list(csv.reader(io.StringIO(csv_text)))
        self.assertEqual(parsed[0],["name","amount"])
        self.assertEqual(parsed[-1],["Row 1199","1199"])
        self.assertEqual(len(parsed),701)
        self.assertEqual(calls,[(500,503),(500,750),(750,1000),(1000,1200)])

    def test_unsafe_numeric_row_ids_are_rejected(self):
        req={"datasetId":"a","requestId":1,"start":0,"end":2}
        def unsafe(a,b):
            return {"rowIds":[2**53,2**53+1],
                    "data":[["First",1],["Second",2]]}
        with self.assertRaisesRegex(ValueError,"JavaScript-safe"):
            window_response(req,dataset_id="a",row_count=2,
                            columns=self.columns,fetch_rows=unsafe)
        def stable(a,b):
            return {"rowIds":[str(2**53),str(2**53+1)],
                    "data":[["First",1],["Second",2]]}
        result=window_response(req,dataset_id="a",row_count=2,
                               columns=self.columns,fetch_rows=stable)
        self.assertEqual(result["rowIds"],[str(2**53),str(2**53+1)])

    def test_clipboard_enforces_utf8_bytes_not_character_count(self):
        text="😀" * 300_000
        cols=[{"columnId":"text"}]
        req={"datasetId":"a","requestId":2,"start":0,"end":1,
             "columnStart":0,"columnEnd":1,"columnIds":["text"]}
        def fetch(a,b):
            return {"rowIds":["r"],"data":[[text]]}
        with self.assertRaisesRegex(ValueError,"too large"):
            clipboard_response(req,dataset_id="a",row_count=1,
                               columns=cols,fetch_rows=fetch)
        short=clipboard_response(req,dataset_id="a",row_count=1,
                                 columns=cols,fetch_rows=lambda a,b:
                                 {"rowIds":["r"],"data":[["😀"]*1]})
        self.assertEqual(short["text"],"😀")

    def test_hidden_columns_copy_and_export_by_visible_column_ids(self):
        columns=[{"columnId":"name"},{"columnId":"hidden"},{"columnId":"amount"}]
        def fetch(a,b):
            return {"rowIds":["r1","r2"][a:b],
                    "data":[["Alice","secret",5],["Bob","private",7]][a:b]}
        req={"datasetId":"a","requestId":6,"start":0,"end":2,
             "columnStart":0,"columnEnd":2,"columnIds":["name","amount"]}
        response=clipboard_response(req,dataset_id="a",row_count=2,
                                    columns=columns,fetch_rows=fetch)
        self.assertEqual(response["columnIds"],["name","amount"])
        self.assertEqual(response["text"],"Alice\t5\nBob\t7")
        export="".join(csv_chunks(start=0,end=2,column_start=0,column_end=2,
            column_ids=["name","amount"],row_count=2,columns=columns,fetch_rows=fetch))
        self.assertEqual(list(csv.reader(io.StringIO(export))),[
            ["name","amount"],["Alice","5"],["Bob","7"]])
        for selected in (["name","missing"],["name","name"]):
            with self.assertRaisesRegex(ValueError,"columnIds"):
                clipboard_response({**req,"columnIds":selected},dataset_id="a",
                                  row_count=2,columns=columns,fetch_rows=fetch)

    def test_forward_command_only_calls_host_handler_and_echoes_identity(self):
        calls=[]
        def apply(batch):
            calls.append(batch)
            return {"status":"ok","rowCount":100001,"revision":19}
        batch={"datasetId":"a","streamId":"client","seq":4,"attempt":1,
               "edits":[{"kind":"insert","rowId":"new","position":500}]}
        response=edit_ack(batch,dataset_id="a",apply_batch=apply)
        self.assertEqual(calls,[batch])
        self.assertEqual(response["status"],"ok")
        self.assertEqual(response["seq"],4)
        self.assertEqual(response["rowCount"],100001)
        self.assertEqual(response["revision"],19)

    def test_fail_closed_when_handler_does_not_confirm_commit(self):
        batch={"datasetId":"a","streamId":"client","seq":1,
               "edits":[{"kind":"cell","rowId":"x","columnId":"value","value":1}]}
        for response in [
            {"status":"ok"}, {"status":"ok","rowCount":10,"revision":False},
            {"status":"unknown"}, None,
        ]:
            with self.subTest(response=response), self.assertRaises(ValueError):
                edit_ack(batch,dataset_id="a",apply_batch=lambda _:response)
        rejected=edit_ack({**batch,"datasetId":"not-a"},dataset_id="a",
                          apply_batch=lambda _:self.fail("Must not be called"))
        self.assertEqual(rejected["status"],"conflict")

if __name__=="__main__":
    unittest.main()
