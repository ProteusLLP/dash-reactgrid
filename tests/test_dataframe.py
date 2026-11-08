"""DataFrame constructors, MultiIndex labels and JSON/numeric transport."""
import json
import unittest

from dash_reactgrid import DashReactGrid, Column, decode_numpy_data


class TinyFrame:
    columns = ["label", "value", "date", "flag"]
    dtypes = ["object", "float64", "datetime64[ns]", "boolean"]

    def itertuples(self, index=False, name=None):
        assert index is False and name is None
        yield ("A", 3.5, "2026-10-01", True)
        yield ("B", float("nan"), None, False)


class PolarsStyleFrame:
    columns = ["name", "amount"]
    dtypes = ["String", "Int64"]

    def iter_rows(self):
        yield ("A", 1)
        yield ("B", 2)


class DataFrameTests(unittest.TestCase):
    def test_dataframe_like_rows_without_pandas_dependency(self):
        grid = DashReactGrid.from_dataframe(TinyFrame(), id="test")
        props = grid.to_plotly_json()["props"]
        self.assertEqual([c["type"] for c in props["columns"]],
                         ["text", "number", "date", "checkbox"])
        self.assertEqual(props["columns"][0]["columnId"], "label")
        self.assertEqual(props["data"], [
            ["A", 3.5, "2026-10-01", True],
            ["B", None, None, False],
        ])
        self.assertEqual(props["id"], "test")
        json.dumps(grid.to_plotly_json())

    def test_polars_style_rows_and_override(self):
        grid = DashReactGrid.from_dataframe(
            PolarsStyleFrame(),
            column_types={"amount": "percent"},
            column_options_by_position={1: {"width": 140, "tooltip": "Percentage"}},
        )
        props = grid.to_plotly_json()["props"]
        self.assertEqual(props["columns"][1]["type"], "percent")
        self.assertEqual(props["columns"][1]["tooltip"], "Percentage")
        self.assertEqual(props["columns"][1]["width"], 140)
        self.assertEqual(props["data"], [["A", 1], ["B", 2]])

    def test_numeric_column_labels_do_not_collide_with_positions(self):
        try:
            import pandas as pd
        except ImportError:
            self.skipTest("pandas is optional")
        frame = pd.DataFrame([[10, 20]], columns=[1, 0])
        by_label = DashReactGrid.from_dataframe(
            frame, column_types={0: "percent"},
            column_options={0: {"tooltip": "Label zero"}},
        ).to_plotly_json()["props"]["columns"]
        self.assertEqual([col["type"] for col in by_label],
                         ["number", "percent"])
        self.assertNotIn("tooltip", by_label[0])
        self.assertEqual(by_label[1]["tooltip"], "Label zero")

        by_position = DashReactGrid.from_dataframe(
            frame, column_types_by_position={0: "percent"},
            column_options_by_position={0: {"width": 120}},
        ).to_plotly_json()["props"]["columns"]
        self.assertEqual([col["type"] for col in by_position],
                         ["percent", "number"])
        self.assertEqual(by_position[0]["width"], 120)
        self.assertNotIn("width", by_position[1])

    def test_mixed_numeric_dtype_never_silently_rounds_large_integers(self):
        try:
            import pandas as pd
        except ImportError:
            self.skipTest("pandas is optional")
        unsafe = 9007199254740993
        frame = pd.DataFrame({"large": [unsafe], "rate": [0.5]})
        self.assertEqual(frame.to_numpy().dtype.kind, "f")
        with self.assertRaisesRegex(ValueError, "JavaScript"):
            DashReactGrid.from_dataframe(frame)
        safe = 9007199254740991
        frame = pd.DataFrame({"large": [safe], "rate": [0.5]})
        payload = DashReactGrid.from_dataframe(frame).to_plotly_json()["props"]
        self.assertEqual(payload["data"], [[safe, 0.5]])
        json.dumps(payload)

    def test_optional_numpy_import_failure_falls_back_to_polars_rows(self):
        class NoNumpyPolarsFrame:
            columns = ["amount", "factor"]
            dtypes = ["Int64", "Float64"]

            def to_numpy(self, **kwargs):
                raise ImportError("NumPy is optional and not installed")

            def iter_rows(self):
                yield (5, 1.25)
                yield (6, 2.5)

        payload = DashReactGrid.from_dataframe(
            NoNumpyPolarsFrame()
        ).to_plotly_json()["props"]
        self.assertEqual(payload["data"], [[5, 1.25], [6, 2.5]])

    def test_numpy_datetime64_and_missing_temporal_scalars(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("NumPy is optional")

        class TemporalFrame:
            columns = ["when", "elapsed"]
            dtypes = ["datetime64[ns]", "object"]

            def itertuples(self, index=False, name=None):
                yield (np.datetime64("2026-11-08T13:45:00", "ns"),
                       np.timedelta64("NaT", "ns"))
                yield (np.datetime64("NaT", "ns"),
                       np.timedelta64(4, "D"))

        result = DashReactGrid.from_dataframe(
            TemporalFrame()
        ).to_plotly_json()["props"]
        self.assertEqual(result["columns"][0]["type"], "date")
        self.assertTrue(result["data"][0][0].startswith("2026-11-08T13:45:00"))
        self.assertIsNone(result["data"][0][1])
        self.assertIsNone(result["data"][1][0])
        self.assertEqual(result["data"][1][1], "4 days")
        json.dumps(result)

    def test_index_name_colliding_with_existing_column(self):
        try:
            import pandas as pd
        except ImportError:
            self.skipTest("pandas is optional")
        frame = pd.DataFrame({
            "key": [10, 20], "value": [1.25, 2.5],
        }).set_index("key", drop=False)
        result = DashReactGrid.from_dataframe(
            frame, include_index=True
        ).to_plotly_json()["props"]
        self.assertEqual([c["title"] for c in result["columns"]],
                         ["key", "key", "value"])
        self.assertEqual([c["columnId"] for c in result["columns"]],
                         ["key", "key__2", "value"])
        self.assertEqual(result["data"], [[10, 10, 1.25], [20, 20, 2.5]])
        json.dumps(result)

        class ResetIndexWithoutKeyword(TinyFrame):
            def reset_index(self):
                return self

        fallback = DashReactGrid.from_dataframe(
            ResetIndexWithoutKeyword(), include_index=True
        ).to_plotly_json()["props"]
        self.assertEqual(fallback["data"][0][0], "A")

    def test_numpy_only_frame_rejects_lossy_promoted_integers(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("NumPy is optional")

        class OnlyNumpyFrame:
            columns = ["integer", "fraction"]
            dtypes = ["Int64", "Float64"]

            def to_numpy(self, **kwargs):
                return np.array([[9007199254740992.0, 0.5]],
                                dtype=np.float64)

        with self.assertRaisesRegex(ValueError, "scalar-preserving"):
            DashReactGrid.from_dataframe(OnlyNumpyFrame())

    def test_numpy_only_frame_preserves_datetime_scalars(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("NumPy is optional")

        class OnlyNumpyTemporalFrame:
            columns = ["when"]
            dtypes = ["datetime64[ns]"]

            def to_numpy(self):
                return np.array(
                    ["2026-11-08T13:45:00", "NaT"], dtype="datetime64[ns]"
                ).reshape(-1, 1)

        result = DashReactGrid.from_dataframe(
            OnlyNumpyTemporalFrame()
        ).to_plotly_json()["props"]
        self.assertTrue(result["data"][0][0].startswith("2026-11-08T13:45:00"))
        self.assertIsNone(result["data"][1][0])

    def test_rejects_invalid_inputs_and_duplicate_data_arguments(self):
        with self.assertRaisesRegex(TypeError, "columns"):
            DashReactGrid.from_dataframe(object())
        with self.assertRaisesRegex(TypeError, "generates"):
            DashReactGrid.from_dataframe(TinyFrame(), data=[])
        with self.assertRaises(TypeError):
            DashReactGrid.from_dataframe(TinyFrame(), include_index=True)
        with self.assertRaises(TypeError):
            Column("a", header_path="bad")

    def test_multiindex_groups_duplicates_and_missing_values(self):
        try:
            import pandas as pd
        except ImportError:
            self.skipTest("pandas is optional")
        index = pd.MultiIndex.from_tuples([
            ("Rates", "GBP", "1y"), ("Rates", "GBP", "5y"),
            ("Rates", "USD", "1y"), ("Returns", "Equity", "1y"),
        ])
        frame = pd.DataFrame([[0.01, None, 0.04, 0.12],
                              [0.02, 0.03, 0.05, 0.1]], columns=index)
        grid = DashReactGrid.from_dataframe(frame, column_types_by_position={0: "percent"})
        props = grid.to_plotly_json()["props"]
        self.assertEqual(props["columns"][0]["type"], "percent")
        self.assertEqual(props["columns"][0]["title"], "1y")
        self.assertEqual(props["columns"][0]["headerPath"], ["Rates", "GBP"])
        self.assertEqual(props["columns"][2]["headerPath"], ["Rates", "USD"])
        self.assertEqual(props["columns"][3]["headerPath"], ["Returns", "Equity"])
        self.assertEqual(len(set(c["columnId"] for c in props["columns"])), 4)
        numeric = decode_numpy_data(props["data"])
        import math
        self.assertTrue(math.isnan(float(numeric[0][1])))
        json.dumps(grid.to_plotly_json())

        duplicate = pd.DataFrame([[1, 2, 3]], columns=["A", "A", "A__2"])
        renamed = DashReactGrid.from_dataframe(duplicate).to_plotly_json()["props"]["columns"]
        self.assertEqual([c["columnId"] for c in renamed],
                         ["A", "A__2", "A__2__2"])

    def test_numeric_pandas_uses_binary_numpy_transport(self):
        try:
            import numpy as np
            import pandas as pd
        except ImportError:
            self.skipTest("pandas and NumPy are optional")
        frame = pd.DataFrame({"a": [1.25, 2.5], "b": [3.0, np.nan]})
        props = DashReactGrid.from_dataframe(frame).to_plotly_json()["props"]
        self.assertIn("__dash_reactgrid_ndarray__", props["data"])
        self.assertEqual(props["columns"][0]["type"], "number")
        decoded = decode_numpy_data(props["data"])
        self.assertAlmostEqual(float(decoded[0, 0]), 1.25)
        self.assertTrue(np.isnan(decoded[1, 1]))
        json.dumps(props)

    def test_include_index_and_datetime_serialization(self):
        try:
            import pandas as pd
        except ImportError:
            self.skipTest("pandas is optional")
        frame = pd.DataFrame({"event": pd.to_datetime(["2026-11-08", None]),
                              "name": ["a", "b"]}, index=pd.Index([7, 9], name="key"))
        props = DashReactGrid.from_dataframe(
            frame, include_index=True, column_options={"event": {"tooltip": "Date"}},
        ).to_plotly_json()["props"]
        self.assertEqual([c["title"] for c in props["columns"]],
                         ["key", "event", "name"])
        self.assertEqual(props["data"][0][0], 7)
        self.assertEqual(props["data"][0][1], "2026-11-08T00:00:00")
        self.assertIsNone(props["data"][1][1])
        json.dumps(props)


if __name__ == "__main__":
    unittest.main()
