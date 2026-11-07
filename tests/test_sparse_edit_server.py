import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "sparse_edit_server", Path(__file__).resolve().parents[1] / "examples" / "sparse_edit_server.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SparseGridStore = MODULE.SparseGridStore


class SparseGridStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "grid.db"
        self.store = SparseGridStore(
            self.path, "pricing-table", ["name", "amount"],
            new_row={"name": "", "amount": 5},
        )
        self.store.seed_once([["a", 1], ["b", 2]], ["r1", "r2"])

    def event(self, seq, edits, stream="tab-1", attempt=1):
        return {
            "datasetId": "pricing-table", "streamId": stream,
            "seq": seq, "attempt": attempt, "edits": edits,
        }

    def test_bounded_indexed_viewport_read(self):
        self.assertEqual(self.store.row_count(), 2)
        self.assertEqual(self.store.read_range(0, 1),
                         {"rowIds": ["r1"], "data": [["a", 1]]})
        self.assertEqual(self.store.read_range(1, 2),
                         {"rowIds": ["r2"], "data": [["b", 2]]})
        with self.assertRaisesRegex(ValueError, "end"):
            self.store.read_range(1, 3)
        with self.assertRaisesRegex(ValueError, "safety"):
            self.store.read_range(0, 1001)

    def test_single_cell_change_commits_and_acknowledges(self):
        event = self.event(1, [{"kind": "cell", "rowId": "r1", "columnId": "amount", "value": 10}])
        self.assertEqual(self.store.apply(event),
                         {"datasetId": "pricing-table", "streamId": "tab-1", "seq": 1, "status": "ok"})
        self.assertEqual(self.store.read()["data"][0], ["a", 10])

    def test_lost_ack_retries_are_idempotent_even_for_add_and_remove(self):
        add = self.event(1, [
            {"kind": "add", "rowId": "new-x"},
            {"kind": "cell", "rowId": "new-x", "columnId": "name", "value": "c"},
        ])
        self.assertEqual(self.store.apply(add)["status"], "ok")
        self.assertEqual(self.store.apply({**add, "attempt": 9})["status"], "ok")
        self.assertEqual(self.store.read()["rowIds"], ["r1", "r2", "new-x"])
        self.assertEqual(self.store.read()["data"][-1], ["c", 5])

        removal = self.event(2, [{"kind": "remove", "rowIds": ["r1"]}])
        self.assertEqual(self.store.apply(removal)["status"], "ok")
        self.assertEqual(self.store.apply({**removal, "attempt": 3})["status"], "ok")
        self.assertEqual(self.store.read()["rowIds"], ["r2", "new-x"])

    def test_duplicate_sequence_with_different_payload_is_rejected(self):
        x = self.event(1, [{"kind": "cell", "rowId": "r1", "columnId": "amount", "value": 10}])
        y = self.event(1, [{"kind": "cell", "rowId": "r1", "columnId": "amount", "value": 11}])
        self.assertEqual(self.store.apply(x)["status"], "ok")
        self.assertEqual(self.store.apply(y)["status"], "conflict")
        self.assertEqual(self.store.read()["data"][0][1], 10)

    def test_out_of_order_edit_is_rejected_without_side_effects(self):
        event = self.event(2, [{"kind": "remove", "rowIds": ["r1"]}])
        self.assertEqual(self.store.apply(event)["status"], "conflict")
        self.assertEqual(self.store.read()["rowIds"], ["r1", "r2"])
        self.assertEqual(self.store.apply(self.event(1, [{"kind": "remove", "rowIds": ["r1"]}]))["status"], "ok")
        self.assertEqual(self.store.apply(event)["status"], "ok")

    def test_transaction_rolls_back_all_prior_edits_in_invalid_batch(self):
        event = self.event(1, [
            {"kind": "add", "rowId": "new-x"},
            {"kind": "cell", "rowId": "missing", "columnId": "amount", "value": 8},
        ])
        self.assertEqual(self.store.apply(event)["status"], "conflict")
        self.assertEqual(self.store.read()["rowIds"], ["r1", "r2"])
        corrected = self.event(1, [{"kind": "add", "rowId": "new-x"}])
        self.assertEqual(self.store.apply(corrected)["status"], "ok")

    def test_restart_retains_dedupe_receipts_and_current_data(self):
        first = self.event(1, [{"kind": "cell", "rowId": "r2", "columnId": "amount", "value": 99}])
        self.assertEqual(self.store.apply(first)["status"], "ok")
        again = SparseGridStore(self.path, "pricing-table", ["name", "amount"],
                                new_row={"name": "", "amount": 5})
        again.seed_once([["a", 1], ["b", 2]], ["r1", "r2"])
        self.assertEqual(again.read()["data"][1][1], 99)
        self.assertEqual(again.apply(first)["status"], "ok")

    def test_incorrect_dataset_cannot_change_rows(self):
        event = self.event(1, [{"kind": "remove", "rowIds": ["r1"]}])
        self.assertEqual(self.store.apply({**event, "datasetId": "other"})["status"], "conflict")
        self.assertEqual(self.store.read()["rowIds"], ["r1", "r2"])

    def test_separate_streams_have_separate_sequences(self):
        first = self.event(1, [{"kind": "cell", "rowId": "r1", "columnId": "amount", "value": 10}])
        other = self.event(1, [{"kind": "cell", "rowId": "r2", "columnId": "amount", "value": 20}], stream="tab-2")
        self.assertEqual(self.store.apply(first)["status"], "ok")
        self.assertEqual(self.store.apply(other)["status"], "ok")
        self.assertEqual(self.store.read()["data"], [["a", 10], ["b", 20]])

    def test_initial_empty_dataset_is_never_reseeded(self):
        empty = SparseGridStore(self.path, "empty-dataset", ["name", "amount"])
        empty.seed_once([], [])
        empty.seed_once([["surprise", 1]], ["unexpected"])
        self.assertEqual(empty.read()["rowIds"], [])

    def test_remove_last_row_does_not_seed_original_rows_on_restart(self):
        self.assertEqual(self.store.apply(self.event(1, [
            {"kind": "remove", "rowIds": ["r1", "r2"]}
        ]))["status"], "ok")
        again = SparseGridStore(self.path, "pricing-table", ["name", "amount"],
                                new_row={"name": "", "amount": 5})
        again.seed_once([["a", 1], ["b", 2]], ["r1", "r2"])
        self.assertEqual(again.read()["data"], [])


if __name__ == "__main__":
    unittest.main()
