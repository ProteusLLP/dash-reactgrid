"""Coverage for the public Python Column helper and Dash serialization."""
import json
import unittest

from dash_reactgrid import Column, DashReactGrid


class ColumnHelperTests(unittest.TestCase):
    def test_minimal_column_and_optional_fields(self):
        self.assertEqual(Column("ticker"), {
            "columnId": "ticker", "title": "ticker", "type": "text",
        })
        column = Column(
            "price", "Price", type="number", tooltip="Market value",
            width=125, align="right",
            style={"color": "blue"}, header_style={"fontWeight": "bold"},
            format_options={"maximumFractionDigits": 2},
            non_editable=False, class_name="price",
            editable_when=[{"columnId": "state", "in": ["open"]}],
        )
        self.assertEqual(column["tooltip"], "Market value")
        self.assertEqual(column["headerStyle"], {"fontWeight": "bold"})
        self.assertEqual(column["formatOptions"], {"maximumFractionDigits": 2})
        self.assertEqual(column["nonEditable"], False)
        self.assertEqual(column["className"], "price")
        self.assertEqual(column["editableWhen"][0]["columnId"], "state")
        self.assertNotIn("values", column)
        self.assertEqual(column.to_dict(), dict(column))
        self.assertIs(type(column.to_dict()), dict)

    def test_dropdown_and_json_serialization_in_mixed_columns(self):
        dropdown = Column(
            "state", "State", type="dropdown",
            values=[{"label": "Open", "value": "open"}, "closed"],
            tooltip="Workflow status",
        )
        columns = [dropdown, {"columnId": "count", "title": "Count", "type": "number"}]
        grid = DashReactGrid(columns=columns, data=[["open", 12]])
        encoded = json.loads(json.dumps(grid.to_plotly_json()))
        self.assertEqual(encoded["props"]["columns"][0], dict(dropdown))
        self.assertEqual(encoded["props"]["columns"][1], columns[1])
        self.assertEqual(encoded["props"]["data"], [["open", 12]])

    def test_invalid_basic_arguments(self):
        for value in ("", None, 123):
            with self.subTest(value=value), self.assertRaises(ValueError):
                Column(value)
        with self.assertRaises(TypeError):
            Column("x", title=4)
        with self.assertRaises(ValueError):
            Column("x", type="")
        with self.assertRaises(TypeError):
            Column("x", tooltip=12)


if __name__ == "__main__":
    unittest.main()
