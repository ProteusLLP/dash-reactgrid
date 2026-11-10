"""Contract tests for the Dash API and the stateless, injectable virtual protocol.

These run in Python without a browser or an application database:
    python -m unittest tests.test_component_contract -v
"""
import csv
import io
import inspect
import re
from pathlib import Path
import json
import unittest

from dash_reactgrid import DashReactGrid
from dash_reactgrid.stateless_virtual import (
    clipboard_response, csv_chunks, edit_ack, window_response,
)

COLUMNS = [
    {"columnId": "text", "title": "Text", "type": "text"},
    {"columnId": "amount", "title": "Amount", "type": "number"},
    {"columnId": "custom", "title": "Custom", "type": "customnumber"},
    {"columnId": "percent", "title": "Percent", "type": "percent"},
    {"columnId": "status", "title": "Status", "type": "dropdown",
     "values": [{"label": "Open", "value": "open"}, "closed"]},
    {"columnId": "flag", "title": "Flag", "type": "checkbox"},
    {"columnId": "date", "title": "Date", "type": "date"},
    {"columnId": "time", "title": "Time", "type": "time"},
]
ROWS = [
    ['A\t"quoted"\nsecond line', 1234.5, -3.2, .25,
     "open", True, "2026-11-07", "2026-11-07T12:30:00Z"],
    ["£ and 😀", None, 0, None, "closed", False, None, None],
    ["Tail", 9.5, 42, .15, "open", True, "2026-12-01", "2026-12-01T08:00:00Z"],
]
DATASET = "contract-fixture-v1"


def read_rows(start, end):
    return {
        "rowIds": ["row-" + str(i) for i in range(start, end)],
        "data": [list(row) for row in ROWS[start:end]],
    }


def viewport(start=0, end=2):
    return {"datasetId": DATASET, "requestId": "req-7", "start": start, "end": end}


def copy_request(start=0, end=2, first=0, last=8, column_ids=None):
    request = {
        **viewport(start, end),
        "columnStart": first, "columnEnd": last,
    }
    if column_ids is not None:
        request["columnIds"] = column_ids
    return request


def tsv_rows(text):
    return list(csv.reader(io.StringIO(text), delimiter="\t"))


class ComponentPublicAPI(unittest.TestCase):
    def test_column_type_matrix_serializes(self):
        grid = DashReactGrid(
            id="matrix", columns=COLUMNS, data=ROWS,
            rowIds=["r0", "r1", "r2"], isExtendable=True,
            newRow={"status": "open", "flag": False},
            lockedCells=[["r1", "amount"]],
            hiddenColumns=["custom"],
            dropdownMenuPortal=True,
            stickyTopRows=1, rowPageSize=2,
        )
        payload = json.loads(json.dumps(grid.to_plotly_json()))
        props = payload["props"]
        self.assertEqual(payload["type"], "DashReactGrid")
        self.assertEqual(payload["namespace"], "dash_reactgrid")
        self.assertEqual([c["type"] for c in props["columns"]],
                         [c["type"] for c in COLUMNS])
        self.assertEqual(props["data"], ROWS)
        self.assertEqual(props["rowIds"], ["r0", "r1", "r2"])
        self.assertEqual(props["lockedCells"], [["r1", "amount"]])
        self.assertEqual(props["hiddenColumns"], ["custom"])
        self.assertTrue(props["dropdownMenuPortal"])
        self.assertTrue(props["isExtendable"])

    def test_grid_supports_sparse_and_virtual_modes(self):
        for config in [
            {"transmitSparseEdits": True, "editDatasetId": DATASET,
             "rowIds": ["r0"]},
            {"virtualRowCount": 100_000, "virtualDatasetId": DATASET,
             "virtualWindowSize": 120, "virtualViewportHeight": 420,
             "virtualClipboardUrl": "/clipboard.tsv",
             "transmitSparseEdits": True, "editDatasetId": DATASET},
        ]:
            with self.subTest(config=config):
                grid = DashReactGrid(
                    id="test", columns=COLUMNS, data=[ROWS[0]] if
                    "virtualRowCount" not in config else [], **config
                )
                props = grid.to_plotly_json()["props"]
                for key, value in config.items():
                    self.assertEqual(props[key], value)

    def test_legacy_python_and_r_positional_arguments_remain_stable(self):
        # New properties are appended after the legacy signatures.
        expected_python=["id","columns","data","rowIds","rowPageSize",
                         "virtualRowCount","virtualDatasetId",
                         "virtualRowHeight","virtualWindowSize"]
        params=list(inspect.signature(DashReactGrid.__init__).parameters)
        self.assertEqual(params[1:1+len(expected_python)],expected_python)
        self.assertEqual(params[-4:-1],["virtualFindRequest","virtualFindData","virtualClipboardUrl"])
        existing=DashReactGrid("test",COLUMNS,ROWS,["r0","r1","r2"],2)
        self.assertEqual(existing.to_plotly_json()["props"]["rowPageSize"],2)
        r_file=Path(__file__).resolve().parents[1]/"R"/"dashReactGrid.R"
        r_source=r_file.read_text(encoding="utf-8")
        match=re.search(r"dashReactGrid <- function[(](.*?)[)] [{]",r_source)
        self.assertIsNotNone(match)
        r_args=[item.split("=",1)[0] for item in match.group(1).split(", ")]
        self.assertEqual(r_args[:9],["id","className","columns","data",
            "disableVirtualScrolling","dropdownMenuPortal","edits",
            "editAck","editDatasetId"])
        self.assertEqual(r_args[-3:],["virtualFindRequest","virtualFindData","virtualClipboardUrl"])
        rd_file=Path(__file__).resolve().parents[1]/"man"/"dashReactGrid.Rd"
        rd_source=rd_file.read_text(encoding="utf-8")
        usage=rd_source.split(r"\usage{",1)[1].split("}",1)[0]
        usage_arguments=usage.split("dashReactGrid(",1)[1].rsplit(")",1)[0]
        rd_args=[item.strip().split("=",1)[0] for item in
                 usage_arguments.replace("\n"," ").split(", ")]
        self.assertEqual(rd_args,r_args)


    def test_required_properties(self):
        with self.assertRaises(TypeError):
            DashReactGrid(data=ROWS)
        with self.assertRaises(TypeError):
            DashReactGrid(columns=COLUMNS)


class StatelessWindowContract(unittest.TestCase):
    def test_column_type_matrix_and_row_order(self):
        request = viewport(1, 3)
        answer = window_response(
            request, dataset_id=DATASET, row_count=len(ROWS),
            columns=COLUMNS, fetch_rows=read_rows
        )
        self.assertEqual(answer["datasetId"], DATASET)
        self.assertEqual(answer["requestId"], request["requestId"])
        self.assertEqual(answer["start"], 1)
        self.assertEqual(answer["rowIds"], ["row-1", "row-2"])
        self.assertEqual(answer["data"], ROWS[1:3])

    def test_100k_row_requests_are_bounded_and_do_not_materialise_other_rows(self):
        calls = []

        def indexed(start, end):
            calls.append((start, end))
            return {"rowIds": [f"id-{i}" for i in range(start, end)],
                    "data": [[str(i)] for i in range(start, end)]}

        request = {"datasetId": DATASET, "requestId": 1,
                   "start": 95_000, "end": 95_120}
        result = window_response(
            request, dataset_id=DATASET, row_count=100_000,
            columns=[COLUMNS[0]], fetch_rows=indexed
        )
        self.assertEqual(calls, [(95_000, 95_120)])
        self.assertEqual(len(result["data"]), 120)
        self.assertEqual(result["data"][0], ["95000"])
        self.assertEqual(result["data"][-1], ["95119"])

    def test_rejects_invalid_window_requests_before_calling_provider(self):
        bad = [
            {"start": -1, "end": 1},
            {"start": True, "end": 1},
            {"start": 0, "end": 0},
            {"start": 2, "end": 1},
            {"start": 0, "end": 1001},
            {"start": 2, "end": 4},
            {"start": 0.0, "end": 1},
            {"start": "0", "end": 1},
        ]
        for fields in bad:
            with self.subTest(fields=fields):
                invoked = []
                with self.assertRaises(ValueError):
                    window_response(
                        {**viewport(), **fields},
                        dataset_id=DATASET, row_count=3,
                        columns=COLUMNS,
                        fetch_rows=lambda a, b: invoked.append((a, b))
                    )
                self.assertEqual(invoked, [])

    def test_rejects_stale_dataset_and_invalid_count(self):
        for request in [None, {}, {**viewport(), "datasetId": "old"}]:
            with self.subTest(request=request):
                with self.assertRaises(ValueError):
                    window_response(request, dataset_id=DATASET,
                                    row_count=3, columns=COLUMNS,
                                    fetch_rows=read_rows)
        for count in [-1, True, 2**53]:
            with self.subTest(count=count):
                with self.assertRaises(ValueError):
                    window_response(viewport(), dataset_id=DATASET,
                                    row_count=count, columns=COLUMNS,
                                    fetch_rows=read_rows)

    def test_rejects_malformed_provider_results(self):
        cases = [
            None,
            {"rowIds": ["x"], "data": [ROWS[0]]},
            {"rowIds": ["x", "x"], "data": ROWS[:2]},
            {"rowIds": [True, "x"], "data": ROWS[:2]},
            {"rowIds": [2**53, "x"], "data": ROWS[:2]},
            {"rowIds": ["x", "y"], "data": [ROWS[0][:-1], ROWS[1]]},
            {"rowIds": ["x", "y"], "data": [tuple(ROWS[0]), ROWS[1]]},
        ]
        for result in cases:
            with self.subTest(result=str(result)[:120]):
                with self.assertRaises(ValueError):
                    window_response(
                        viewport(), dataset_id=DATASET,
                        row_count=3, columns=COLUMNS,
                        fetch_rows=lambda *_: result
                    )


class StatelessClipboardContract(unittest.TestCase):
    def test_excel_tsv_preserves_unicode_tabs_quotes_and_newlines(self):
        req = copy_request(0, 3)
        result = clipboard_response(
            req, dataset_id=DATASET, row_count=3,
            columns=COLUMNS, fetch_rows=read_rows
        )
        for key in ("datasetId", "requestId", "start", "end",
                    "columnStart", "columnEnd"):
            self.assertEqual(result[key], req[key])
        cells = tsv_rows(result["text"])
        expected = [
            ["" if item is None else str(item) for item in row]
            for row in ROWS
        ]
        self.assertEqual(cells, expected)
        self.assertEqual(cells[0][0], 'A\t"quoted"\nsecond line')
        self.assertEqual(cells[1][0], "£ and 😀")

    def test_hidden_and_reordered_column_ids_map_to_source_indices(self):
        req = copy_request(0, 2, 0, 2, ["percent", "text"])
        result = clipboard_response(
            req, dataset_id=DATASET, row_count=3,
            columns=COLUMNS, fetch_rows=read_rows
        )
        self.assertEqual(result["columnIds"], ["percent", "text"])
        self.assertEqual(tsv_rows(result["text"]), [
            [str(ROWS[0][3]), ROWS[0][0]],
            ["", ROWS[1][0]],
        ])

    def test_bad_columns_rejected(self):
        bad = [
            ["amount", "amount"], ["missing", "text"],
            ["text"], "text,amount", [2, 3],
        ]
        for ids in bad:
            with self.subTest(ids=ids):
                with self.assertRaises(ValueError):
                    clipboard_response(
                        copy_request(0, 2, 0, 2, ids), dataset_id=DATASET,
                        row_count=3, columns=COLUMNS, fetch_rows=read_rows
                    )

    def test_clipboard_enforces_utf8_byte_cap(self):
        req = copy_request(1, 2, 0, 1)
        with self.assertRaisesRegex(ValueError, "too large"):
            clipboard_response(
                req, dataset_id=DATASET, row_count=3,
                columns=COLUMNS, fetch_rows=read_rows, max_bytes=5
            )
        ok = clipboard_response(
            req, dataset_id=DATASET, row_count=3,
            columns=COLUMNS, fetch_rows=read_rows, max_bytes=1000
        )
        self.assertEqual(tsv_rows(ok["text"]), [["£ and 😀"]])

    def test_csv_export_streams_bounded_chunks_and_column_order(self):
        calls = []

        def provider(start, end):
            calls.append((start, end))
            return read_rows(start, end)

        stream = csv_chunks(
            start=0, end=3, column_start=0, column_end=2,
            row_count=3, columns=COLUMNS, fetch_rows=provider,
            chunk_size=2, column_ids=["status", "text"]
        )
        header = next(stream)
        self.assertEqual(header, "status,text\r\n")
        body = "".join(stream)
        self.assertEqual(calls, [(0, 2), (2, 3)])
        self.assertEqual(list(csv.reader(io.StringIO(header + body))), [
            ["status", "text"],
            ["open", ROWS[0][0]],
            ["closed", ROWS[1][0]],
            ["open", ROWS[2][0]],
        ])

    def test_csv_invalid_ranges_fail_without_fetches(self):
        for start, end, size in [(0, 0, 1), (-1, 1, 1),
                                 (0, 4, 2), (0, 1, 0), (0, 1, 1001)]:
            with self.subTest(start=start, end=end, size=size):
                calls = []
                with self.assertRaises(ValueError):
                    list(csv_chunks(
                        start=start, end=end, column_start=0, column_end=1,
                        row_count=3, columns=COLUMNS, chunk_size=size,
                        fetch_rows=lambda a, b: calls.append((a, b))
                    ))
                self.assertFalse(calls)


class StatelessEditContract(unittest.TestCase):
    def test_sparse_batch_forwards_unmodified_and_echoes_identity(self):
        batch = {
            "datasetId": DATASET, "streamId": "tab-1", "seq": 7,
            "attempt": 2,
            "edits": [{"kind": "cell", "rowId": "r0",
                       "columnId": "percent", "value": .2},
                      {"kind": "cell", "rowId": "r0",
                       "columnId": "flag", "value": False}],
        }
        calls = []

        def commit(command):
            calls.append(command)
            return {"status": "ok", "rowCount": 3, "revision": 4}

        response = edit_ack(batch, dataset_id=DATASET, apply_batch=commit)
        self.assertEqual(calls, [batch])
        self.assertEqual(response, {
            "datasetId": DATASET, "streamId": "tab-1", "seq": 7,
            "status": "ok", "rowCount": 3, "revision": 4
        })
        self.assertEqual(batch["attempt"], 2)

    def test_invalid_batches_never_reach_commit(self):
        valid = {"datasetId": DATASET, "streamId": "tab-1", "seq": 1,
                 "edits": [{"kind": "cell", "rowId": "r0",
                            "columnId": "text", "value": "X"}]}
        cases = [
            {**valid, "datasetId": "wrong"},
            {**valid, "streamId": ""},
            {**valid, "streamId": None},
            {**valid, "seq": 0},
            {**valid, "seq": True},
            {**valid, "edits": []},
            {**valid, "edits": "not an array"},
        ]
        for batch in cases:
            with self.subTest(batch=batch):
                calls = []
                answer = edit_ack(
                    batch, dataset_id=DATASET,
                    apply_batch=lambda value: calls.append(value)
                )
                self.assertEqual(answer["status"], "conflict")
                self.assertFalse(calls)

    def test_retry_and_conflict_are_not_reported_as_committed(self):
        batch = {"datasetId": DATASET, "streamId": "s1", "seq": 2,
                 "edits": [{"kind": "undo", "targetSeq": 1}]}
        for status in ("retry", "error", "conflict"):
            result = edit_ack(
                batch, dataset_id=DATASET,
                apply_batch=lambda _: {"status": status, "message": "test"}
            )
            self.assertEqual(result["status"], status)
            self.assertEqual(result["message"], "test")

    def test_success_needs_valid_revision_and_count(self):
        batch = {"datasetId": DATASET, "streamId": "s1", "seq": 2,
                 "edits": [{"kind": "insert", "at": 2}]}
        invalid = [
            {"status": "ok"},
            {"status": "ok", "rowCount": True, "revision": 2},
            {"status": "ok", "rowCount": -1, "revision": 2},
            {"status": "ok", "rowCount": 3, "revision": False},
            {"status": "ok", "rowCount": 3, "revision": -1},
            {"status": "unknown"},
            None,
        ]
        for result in invalid:
            with self.subTest(result=result):
                with self.assertRaises(ValueError):
                    edit_ack(batch, dataset_id=DATASET,
                             apply_batch=lambda _: result)


if __name__ == "__main__":
    unittest.main()
