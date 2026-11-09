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
find_response = module.find_response
csv_chunks = module.csv_chunks
tsv_chunks = module.tsv_chunks
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

    def test_large_clipboard_tsv_streams_all_rows_without_a_dense_result(self):
        calls=[]
        def source(start,end):
            calls.append((start,end))
            return {"rowIds":[f"r{i}" for i in range(start,end)],
                    "data":[[f"Record {i}",i] for i in range(start,end)]}
        chunks=list(tsv_chunks(
            start=0,end=100_000,column_start=0,column_end=2,
            row_count=100_000,columns=self.columns,fetch_rows=source,
            chunk_size=250))
        self.assertEqual(len(chunks),400)
        self.assertEqual(len(calls),400)
        self.assertEqual(calls[0],(0,250))
        self.assertEqual(calls[-1],(99750,100000))
        self.assertTrue(all(end-start<=250 for start,end in calls))
        self.assertTrue(chunks[0].startswith("Record 0\t0\r\n"))
        self.assertTrue(chunks[-1].endswith("Record 99999\t99999"))
        self.assertFalse(chunks[-1].endswith("\r\n"))

    def test_streamed_tsv_quotes_embedded_tabs_newlines_and_hidden_columns(self):
        cols=[{"columnId":"name"},{"columnId":"hidden"},{"columnId":"value"}]
        def source(a,b):
            return {"rowIds":["r1","r2"][a:b],
                    "data":[["Contains\ttab","secret",5],
                            ['Line\n"quote"',None,7]][a:b]}
        stream="".join(tsv_chunks(start=0,end=2,column_start=0,
            column_end=2,row_count=2,columns=cols,fetch_rows=source,
            chunk_size=1,column_ids=["name","value"]))
        parsed=list(csv.reader(io.StringIO(stream),delimiter="\t"))
        self.assertEqual(parsed,[["Contains\ttab","5"],['Line\n"quote"',"7"]])
        for bad in (["name","name"],["name","does-not-exist"]):
            with self.assertRaises(ValueError):
                list(tsv_chunks(start=0,end=2,column_start=0,
                    column_end=2,row_count=2,columns=cols,fetch_rows=source,
                    column_ids=bad))

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

    def test_search_unloaded_rows_with_bounded_memory_and_wrap(self):
        requested = []
        def fetch(start, end):
            requested.append((start, end))
            return self.source(start, end)
        def query(text, row=-1, column=-1, direction="forward",
                  selected=None):
            req = {"datasetId":"sample", "requestId":55, "query":text,
                   "afterRow":row, "afterColumn":column,
                   "direction":direction,
                   "columnIds":selected or ["name", "amount"]}
            return find_response(req, dataset_id="sample", row_count=self.count,
                                 columns=self.columns, fetch_rows=fetch,
                                 chunk_size=128)

        result=query("Row 99999")
        self.assertEqual((result["rowIndex"],result["columnId"]),(99999,"name"))
        self.assertEqual(result["requestId"],55)
        self.assertTrue(all(0 < end-start <= 128 for start,end in requested))
        # Starting at the final cell wraps and finds the beginning.
        self.assertEqual(query("Row 0",99999,1)["rowIndex"],0)
        # Reverse starts at the end, and wraps backwards.
        self.assertEqual(query("Row 99999",direction="backward")["rowIndex"],99999)
        self.assertEqual(query("Row 99999",0,0,direction="backward")["rowIndex"],99999)
        # Search only the selected visible column.
        self.assertEqual(query("Row 90000",selected=["amount"])["rowIndex"],None)

    def test_search_uses_browser_number_rounding_for_provider_and_dropdown(self):
        # The browser parses JSON numeric cells as IEEE-754 Numbers, so
        # 2**53+1 displays as 2**53. Search must use that same string.
        unsafe = 2**53 + 1
        displayed = str(2**53)
        self.assertEqual(module._find_string(unsafe), displayed)
        self.assertEqual(module._find_string(2**53 - 1), str(2**53 - 1))
        self.assertEqual(module._find_string(10**400), "")
        self.assertEqual(module._find_string(-unsafe), "-" + displayed)

        def fetch(start, end):
            return {"rowIds": ["row"],
                    "data": [[unsafe, unsafe]][start:end]}
        columns = [
            {"columnId": "number", "type": "number"},
            {"columnId": "status", "type": "dropdown",
             "values": [{"value": 2**53, "label": "Rounded label"}]},
        ]
        base = {"datasetId": "precision", "requestId": 90,
                "afterRow": -1, "afterColumn": -1,
                "direction": "forward",
                "columnIds": ["number", "status"], "query": displayed}
        viewport = window_response(
            {"datasetId": "precision", "requestId": 1, "start": 0, "end": 1},
            dataset_id="precision", row_count=1, columns=columns,
            fetch_rows=fetch)
        self.assertEqual(viewport["data"][0][0], unsafe)

        def find(query, selected):
            return find_response(
                {**base, "query": query, "columnIds": selected},
                dataset_id="precision", row_count=1, columns=columns,
                fetch_rows=fetch)
        self.assertEqual(find(displayed, ["number"])["rowIndex"], 0)
        self.assertIsNone(find(str(unsafe), ["number"])["rowIndex"])
        self.assertEqual(find("Rounded label", ["status"])["columnId"],
                         "status")
        self.assertEqual(find("-9007199254740992", ["number"])["rowIndex"],
                         None)

    def test_search_column_order_dropdown_labels_and_validation(self):
        columns=[
            {"columnId":"secret","type":"text"},
            {"columnId":"status","type":"dropdown",
             "values":[{"label":"Waiting on review","value":"p"}]},
            {"columnId":"name","type":"text"},
        ]
        def fetch(start,end):
            return {"rowIds":[f"r{i}" for i in range(start,end)],
                    "data":[["hidden target","p","needle"] for _ in range(start,end)]}
        def request(**extra):
            return {"datasetId":"s","requestId":4,"query":"wait",
                    "afterRow":-1,"afterColumn":-1,"direction":"forward",
                    "columnIds":["name","status"],**extra}
        found=find_response(request(),dataset_id="s",row_count=2,
                            columns=columns,fetch_rows=fetch)
        self.assertEqual((found["rowIndex"],found["columnId"]),(0,"status"))
        absent=find_response({**request(),"query":"hidden"},
                             dataset_id="s",row_count=2,columns=columns,
                             fetch_rows=fetch)
        self.assertIsNone(absent["rowIndex"])
        # A dropdown label/value separator must not contain a literal
        # backslash-n sequence which would make every label match 'n'.
        ready_columns=[{"columnId":"state","type":"dropdown",
                        "values":[{"label":"Ready","value":"p"}]}]
        ready_request={"datasetId":"s","requestId":5,"query":"n",
                       "afterRow":-1,"afterColumn":-1,
                       "direction":"forward","columnIds":["state"]}
        ready=find_response(
            ready_request,dataset_id="s",row_count=1,
            columns=ready_columns,
            fetch_rows=lambda start,end:{"rowIds":["row"],"data":[["p"]]},
        )
        self.assertIsNone(ready["rowIndex"])
        # A JSON numeric option (1) and float provider value (1.0)
        # represent the same JavaScript Number, including for label search.
        numeric_columns=[{"columnId":"status","type":"dropdown",
                          "values":[{"label":"Pending review","value":1}]}]
        numeric_request={**ready_request,"query":"Pending","columnIds":["status"]}
        numeric=find_response(
            numeric_request,dataset_id="s",row_count=1,
            columns=numeric_columns,
            fetch_rows=lambda start,end:{"rowIds":["r"],"data":[[1.0]]},
        )
        self.assertEqual(numeric["rowIndex"],0)
        bool_columns=[{"columnId":"state","type":"dropdown",
                       "values":[{"label":"Approved","value":True}]}]
        bool_search=find_response(
            {**ready_request,"query":"Approved","columnIds":["state"]},
            dataset_id="s",row_count=1,columns=bool_columns,
            fetch_rows=lambda start,end:{"rowIds":["r"],"data":[[True]]},
        )
        self.assertEqual(bool_search["rowIndex"],0)
        null_label_columns=[{"columnId":"state","type":"dropdown",
                             "values":[{"label":None,"value":"p"}]}]
        null_label=find_response(
            {**ready_request,"query":"none","columnIds":["state"]},
            dataset_id="s",row_count=1,columns=null_label_columns,
            fetch_rows=lambda start,end:{"rowIds":["r"],"data":[["p"]]},
        )
        self.assertIsNone(null_label["rowIndex"])
        null_label_fallback=find_response(
            {**ready_request,"query":"p","columnIds":["state"]},
            dataset_id="s",row_count=1,columns=null_label_columns,
            fetch_rows=lambda start,end:{"rowIds":["r"],"data":[["p"]]},
        )
        self.assertEqual(null_label_fallback["rowIndex"],0)
        scalar_label=find_response(
            {**ready_request,"query":"false","columnIds":["state"]},
            dataset_id="s",row_count=1,
            columns=[{"columnId":"state","type":"dropdown",
                      "values":[{"label":False,"value":"p"}]}],
            fetch_rows=lambda start,end:{"rowIds":["r"],"data":[["p"]]},
        )
        self.assertEqual(scalar_label["rowIndex"],0)
        self.assertEqual(module._find_string(1e-6),"0.000001")
        self.assertEqual(module._find_string(1e21),"1e+21")
        self.assertEqual(module._find_string(1e-7),"1e-7")
        self.assertEqual(module._find_string(1e20),"100000000000000000000")
        self.assertEqual(module._find_string(-0.0),"0")
        for number, query in [(1e-6,"0.000001"), (1e21,"1e+21")]:
            answer=find_response(
                {**ready_request,"query":query,"columnIds":["state"]},
                dataset_id="s",row_count=1,
                columns=[{"columnId":"state","type":"number"}],
                fetch_rows=lambda start,end, n=number:{"rowIds":["r"],
                                                       "data":[[n]]},
            )
            self.assertEqual(answer["rowIndex"],0)

        # Python casefold would equate ß with ss; JS lowercase does not.
        name_columns=[{"columnId":"name","type":"text"}]
        name_request={**ready_request,"columnIds":["name"]}
        def look_for(query,value):
            return find_response(
                {**name_request,"query":query},dataset_id="s",
                row_count=1,columns=name_columns,
                fetch_rows=lambda start,end:{"rowIds":["r"],"data":[[value]]},
            )["rowIndex"]
        self.assertIsNone(look_for("SS","Straße"))
        self.assertEqual(look_for("STRAßE","Straße"),0)
        self.assertIsNone(look_for("Ann ","Anne"))
        self.assertEqual(look_for("Ann ","Ann Marie"),0)
        self.assertEqual(look_for(" ","Ann Marie"),0)
        # The numeric transport renders NumPy NaN and infinities as blanks.
        for nonfinite in (float("nan"),float("inf"),-float("inf")):
            self.assertEqual(module._find_string(nonfinite),"")
            self.assertIsNone(look_for("nan",nonfinite))
            self.assertIsNone(look_for("inf",nonfinite))

        for broken in [
            {"query":""}, {"query":"x"*257}, {"direction":"sideways"},
            {"afterRow":2,"afterColumn":0},
            {"columnIds":["secret","secret"]},
            {"columnIds":["missing"]},
            {"afterColumn":False,"afterRow":0},
        ]:
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                find_response({**request(),**broken},dataset_id="s",row_count=2,
                              columns=columns,fetch_rows=fetch)

if __name__=="__main__":
    unittest.main()
