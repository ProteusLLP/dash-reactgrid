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
            column_options={1: {"width": 140, "tooltip": "Percentage"}},
        )
        props = grid.to_plotly_json()["props"]
        self.assertEqual(props["columns"][1]["type"], "percent")
        self.assertEqual(props["columns"][1]["tooltip"], "Percentage")
        self.assertEqual(props["columns"][1]["width"], 140)
        self.assertEqual(props["data"], [["A", 1], ["B", 2]])

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
        grid = DashReactGrid.from_dataframe(frame, column_types={0: "percent"})
        props = grid.to_plotly_json()["props"]
        self.assertEqual(props["columns"][0]["type"], "percent")
        self.assertEqual(props["columns"][0]["title"], "1y")
        self.assertEqual(props["columns"][0]["headerPath"], ["Rates", "GBP"])
        self.assertEqual(props["columns"][2]["headerPath"], ["Rates", "USD"])
        self.assertEqual(props["columns"][3]["headerPath"], ["Returns", "Equity"])
        self.assertEqual(len(set(c["columnId"] for c in props["columns"])), 4)
        self.assertEqual(props["data"][0][1], None)
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
