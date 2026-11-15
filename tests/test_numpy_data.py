"""NumPy transport, precision and Dash component contract tests."""
import json
import unittest

import numpy as np
from dash_reactgrid import DashReactGrid, encode_numpy_data, decode_numpy_data
from dash_reactgrid.numpy_data import MARKER
from dash_reactgrid.stateless_virtual import window_response, clipboard_response, csv_chunks


class NumpyTransportTests(unittest.TestCase):
    def test_numeric_dtype_roundtrips_and_wire_is_json(self):
        arrays = [
            np.array([[0.5, -20], [np.nan, np.inf]], dtype=np.float64),
            np.array([[1.25, 8], [2, 3]], dtype=np.float32),
            np.arange(12, dtype=np.int32).reshape(3, 4),
            np.arange(12, dtype=np.uint16).reshape(3, 4),
            np.array([[1, -3], [0, 2]], dtype=np.int8),
            np.array([[True, False], [False, True]], dtype=bool),
            np.array([[0.25, 0.5]], dtype=np.float16),
            np.array([[2**40, -2**40]], dtype=np.int64),
            np.arange(24, dtype=np.float64).reshape(4, 6)[::2, ::3],
            np.array([[1.25, -2.5]], dtype=">f8"),
            np.empty((0, 3), dtype=np.float64),
        ]
        for array in arrays:
            with self.subTest(dtype=str(array.dtype), shape=array.shape):
                wire = encode_numpy_data(array)
                json.dumps(wire, allow_nan=False)
                self.assertEqual(wire[MARKER], 1)
                self.assertEqual(wire["shape"], list(array.shape))
                self.assertIsInstance(wire["bdata"], str)
                recovered = decode_numpy_data(wire)
                np.testing.assert_array_equal(recovered, array.astype(recovered.dtype))

    def test_masked_ndarrays_reject_hidden_backing_values(self):
        # MaskedArray inherits ndarray. Serializing it as raw bytes would
        # accidentally display the masked value 999 instead of a blank cell.
        masked = np.ma.array([[1.0, 999.0]], mask=[[False, True]])
        with self.assertRaisesRegex(ValueError, "Masked NumPy arrays"):
            encode_numpy_data(masked)
        columns = [
            {"columnId": "a", "title": "A", "type": "number"},
            {"columnId": "b", "title": "B", "type": "number"},
        ]
        with self.assertRaisesRegex(ValueError, "Masked NumPy arrays"):
            DashReactGrid(columns=columns, data=masked)
        # Reject even when no entries happen to be masked, to keep the
        # handling of masked subclasses stable across inputs and edits.
        unmasked = np.ma.array([[1, 2]], mask=False)
        with self.assertRaisesRegex(ValueError, "Masked NumPy arrays"):
            encode_numpy_data(unmasked)

    def test_invalid_dimensions_and_integer_precision(self):
        for array in (np.arange(3), np.zeros((2, 2, 2))):
            with self.assertRaises(ValueError):
                encode_numpy_data(array)
        for array in (np.array([[2**53]], dtype=np.uint64),
                      np.array([[-2**53]], dtype=np.int64)):
            with self.assertRaisesRegex(ValueError, "exact integer range"):
                encode_numpy_data(array)

    def test_mixed_text_and_list_inputs_are_compatible(self):
        arr = np.array([["a", "b"]])
        self.assertEqual(encode_numpy_data(arr), [["a", "b"]])
        obj = np.array([["A", 1], [None, 2]], dtype=object)
        self.assertEqual(encode_numpy_data(obj), [["A", 1], [None, 2]])
        data = [[1, 2]]
        self.assertIs(encode_numpy_data(data), data)
        self.assertIs(decode_numpy_data(data), data)

    def test_bad_binary_payload_rejected(self):
        packed = encode_numpy_data(np.arange(6, dtype=np.float64).reshape(2, 3))
        for changes in (
            {"dtype": "float128"},
            {"shape": [3, 3]},
            {"bdata": "!!!"},
            {"shape": [-1, 3]},
        ):
            with self.subTest(changes=changes), self.assertRaises((ValueError, Exception)):
                decode_numpy_data({**packed, **changes})

    def test_component_encodes_numpy_but_preserves_lists(self):
        columns = [{"columnId": "a", "type": "number", "title": "A"},
                   {"columnId": "b", "type": "number", "title": "B"}]
        array = np.arange(6.0).reshape(3, 2)
        grid = DashReactGrid(id="array", columns=columns, data=array)
        props = json.loads(json.dumps(grid.to_plotly_json()))["props"]
        np.testing.assert_array_equal(decode_numpy_data(props["data"]), array)
        self.assertEqual(props["columns"], columns)
        normal = DashReactGrid(columns=columns, data=[[1, 2]])
        self.assertEqual(normal.to_plotly_json()["props"]["data"], [[1, 2]])
        self.assertEqual(grid.to_plotly_json()["namespace"], "dash_reactgrid")

    def test_numpy_integer_row_ids_in_component(self):
        columns = [{"columnId": "x", "title": "X", "type": "number"}]
        for dtype in (np.int16, np.int32, np.int64, np.uint32, np.uint64):
            with self.subTest(dtype=dtype):
                ids = np.array([0, 1, 100], dtype=dtype)
                grid = DashReactGrid(columns=columns, data=[[1], [2], [3]],
                                     rowIds=ids)
                props = json.loads(json.dumps(grid.to_plotly_json()))["props"]
                self.assertEqual(props["rowIds"], [0, 1, 100])
        large = np.array([2**53, 2**64 - 1], dtype=np.uint64)
        grid = DashReactGrid(columns=columns, data=[[1], [2]], rowIds=large)
        self.assertEqual(grid.to_plotly_json()["props"]["rowIds"],
                         [str(2**53), str(2**64 - 1)])
        negative = np.array([-2**63, 0], dtype=np.int64)
        grid = DashReactGrid(columns=columns, data=[[1], [2]], rowIds=negative)
        self.assertEqual(grid.to_plotly_json()["props"]["rowIds"],
                         [str(-2**63), 0])
        # A safe ID has the same type regardless of other IDs in the window.
        mixed = DashReactGrid(columns=columns, data=[[1], [2]],
                              rowIds=np.array([7, 2**53], dtype=np.uint64))
        alone = DashReactGrid(columns=columns, data=[[1]],
                              rowIds=np.array([7], dtype=np.uint64))
        self.assertEqual(mixed.to_plotly_json()["props"]["rowIds"],
                         [7, str(2**53)])
        self.assertEqual(alone.to_plotly_json()["props"]["rowIds"], [7])

    def test_numpy_row_id_rejects_bad_inputs(self):
        columns = [{"columnId": "x", "title": "X", "type": "number"}]
        for ids in (np.array([1.0]), np.array([True]),
                    np.array([[1]]), np.ma.array([1], mask=[True])):
            with self.subTest(dtype=str(ids.dtype), shape=ids.shape):
                with self.assertRaises((ValueError, TypeError)):
                    DashReactGrid(columns=columns, data=[[1]], rowIds=ids)

    def test_virtual_numpy_row_ids_and_implicit_windows(self):
        columns = [{"columnId": "x"}]
        req = {"datasetId": "numeric", "requestId": 1,
               "start": 50, "end": 52}
        data = np.array([[1], [2]], dtype=np.int32)
        explicit = window_response(req, dataset_id="numeric", row_count=100,
            columns=columns, fetch_rows=lambda a, b:
            {"data": data, "rowIds": np.array([50, 51], dtype=np.int64)})
        self.assertEqual(explicit["rowIds"], [50, 51])
        bare = window_response(req, dataset_id="numeric", row_count=100,
            columns=columns, fetch_rows=lambda a, b: data)
        self.assertNotIn("rowIds", bare)
        np.testing.assert_array_equal(decode_numpy_data(bare["data"]), data)

    def test_virtual_numeric_provider_and_clipboard(self):
        columns = [{"columnId": "a"}, {"columnId": "b"}]
        array = np.arange(20, dtype=np.float32).reshape(10, 2)
        calls = []
        def fetch(start, end):
            calls.append((start, end))
            return {"rowIds": [f"r{i}" for i in range(start, end)],
                    "data": array[start:end]}
        request = {"datasetId": "numeric", "requestId": 8, "start": 3, "end": 7}
        result = window_response(request, dataset_id="numeric", row_count=10,
                                 columns=columns, fetch_rows=fetch)
        self.assertEqual(calls, [(3, 7)])
        np.testing.assert_array_equal(decode_numpy_data(result["data"]), array[3:7])
        clipboard = clipboard_response({
            **request, "columnStart": 0, "columnEnd": 2
        }, dataset_id="numeric", row_count=10, columns=columns,
            fetch_rows=fetch)
        self.assertEqual(clipboard["text"].splitlines()[0], "6.0\t7.0")
        csv_data = "".join(csv_chunks(
            start=3, end=7, column_start=0, column_end=2, row_count=10,
            columns=columns, fetch_rows=fetch))
        self.assertIn("6.0,7.0", csv_data)

    def test_transport_reduces_payload_size(self):
        array = np.random.default_rng(17).normal(size=(10_000, 8))
        binary = json.dumps(encode_numpy_data(array))
        dense = json.dumps(array.tolist())
        self.assertLess(len(binary), len(dense))


if __name__ == "__main__":
    unittest.main()
