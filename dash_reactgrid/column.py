"""Python-friendly, JSON-serialisable column definitions for DashReactGrid."""


class Column(dict):
    """A column definition accepted directly by ``DashReactGrid(columns=...)``.

    Parameters use Python names while the stored keys match the React grid API.
    A ``Column`` is a normal ``dict`` subclass, so Dash can serialize it without
    a special encoder. Plain dictionaries can be mixed with Column instances.

    Args:
        column_id: Unique ID used to locate the column in edits and callbacks.
        title: Visible header label; defaults to ``column_id``.
        type: Cell type (text, number, customnumber, percent, dropdown,
            checkbox, date or time).
        tooltip: Optional text shown on hovering over the column header.
        width: Column width in pixels.
        align: One of "left", "center" or "right".
        style: CSS styles applied to data cells.
        header_style: CSS styles applied to this header.
        format_options: JavaScript Intl formatter options.
        values: Dropdown options.
        non_editable: Whether cells in this column are locked.
        class_name: Extra CSS class applied to the data cells.
        editable_when: Conditional editing rules referencing other columns.
    """

    def __init__(
        self, column_id, title=None, type="text", *, tooltip=None, width=None,
        align=None, style=None, header_style=None, format_options=None,
        values=None, non_editable=None, class_name=None, editable_when=None,
    ):
        if not isinstance(column_id, str) or not column_id:
            raise ValueError("column_id must be a non-empty string")
        if title is None:
            title = column_id
        if not isinstance(title, str):
            raise TypeError("title must be a string")
        if not isinstance(type, str) or not type:
            raise ValueError("type must be a non-empty string")
        if tooltip is not None and not isinstance(tooltip, str):
            raise TypeError("tooltip must be a string or None")

        super().__init__(columnId=column_id, title=title, type=type)
        options = {
            "tooltip": tooltip, "width": width, "align": align,
            "style": style, "headerStyle": header_style,
            "formatOptions": format_options, "values": values,
            "nonEditable": non_editable, "className": class_name,
            "editableWhen": editable_when,
        }
        self.update({name: value for name, value in options.items()
                     if value is not None})

    def to_dict(self):
        """Return a standalone plain dictionary for callers that need one."""
        return dict(self)
