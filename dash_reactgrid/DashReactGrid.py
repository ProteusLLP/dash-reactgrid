# AUTO GENERATED FILE - DO NOT EDIT

import typing  # noqa: F401
from typing_extensions import TypedDict, NotRequired, Literal # noqa: F401
from dash.development.base_component import Component, _explicitize_args
try:
    from dash.types import NumberType  # noqa: F401
except ImportError:
    # Backwards compatibility for dash<=4.1.0
    if typing.TYPE_CHECKING:
        raise
    NumberType = typing.Union[  # noqa: F401
        typing.SupportsFloat, typing.SupportsInt, typing.SupportsComplex
    ]

ComponentSingleType = typing.Union[str, int, float, Component, None]
ComponentType = typing.Union[
    ComponentSingleType,
    typing.Sequence[ComponentSingleType],
]


class DashReactGrid(Component):
    """A DashReactGrid component.


Keyword arguments:

- id (string | dict; optional):
    The ID used to identify this component in Dash callbacks.

- className (string; optional)

- columns (boolean | number | string | dict | list; required):
    The columns: `columnId`, `title`, `type` (text, number, percent,
    dropdown, checkbox, date or time), and optionally `width`,
    `align`, `style`, `headerStyle`, `formatOptions`
    (Intl.NumberFormat options), `values` (a dropdown's options),
    `nonEditable`, `className` (every cell also has
    `rg-col-<columnId>`) and `editableWhen` (rules on the row's other
    values, see `rulesHold`; a cell whose rules fail is locked and has
    the class `rg-cell-na`). A cell the user can edit has the class
    `rg-cell-editable`, tinted light blue; set
    `--drg-editable-cell-color` to change the tint.

- data (boolean | number | string | dict | list; required):
    The rows, each an array of values in column order.

- disableVirtualScrolling (boolean; default True)

- dropdownMenuPortal (boolean; default False):
    Whether dropdown menus render in a portal on the page body, with
    fixed positioning, rather than inside their cell. Turn it on when
    the grid sits in something that clips or scrolls, such as a card
    or the grid's own scroll area, so menus can extend past its edges
    and show above nearby content. Off by default, which keeps
    ReactGrid's own dropdown.

- edits (dict; optional):
    The edits behind the latest change to `data` (read only): `seq`,
    which increases with every change, and `edits`, each one of
    `{kind: \"cell\", rowId, columnId, value}`, `{kind: \"add\",
    rowId}` or `{kind: \"remove\", rowIds}`.

- enableColumnSelection (boolean; default True)

- enableFillHandle (boolean; default True)

- enableRangeSelection (boolean; default True)

- enableRowSelection (boolean; default True)

- hiddenColumns (list; optional):
    The ids of columns not to show; their values stay in `data`.

- highlights (boolean | number | string | dict | list; optional)

- isExtendable (boolean; default False):
    Whether the table shows a blank row after its data, which becomes
    a new row once the user types or pastes into it.

- lockedCells (list; optional):
    Cells the user cannot edit, as `[rowId, columnId]` pairs.

- newRow (list | dict; optional):
    The values a row the user adds starts with: an array in column
    order, or an object by column id. Blank if omitted.

- persisted_props (list of a value equal to: 'columns', 'data's; default ['columns', 'data'])

- persistence (boolean | string | number; optional)

- persistence_type (a value equal to: 'local', 'session', 'memory'; default 'local')

- readOnly (boolean; default False):
    Whether every cell is locked, no row can be added and none
    deleted.

- rowIds (list; optional):
    An id per row of `data`. Given, edits name rows by these ids, rows
    the user adds get ids starting `new-`, and rows can be deleted
    from the context menu. Omitted, rows are named by position.

- selectedCell (boolean | number | string | dict | list; optional)

- selectedRange (boolean | number | string | dict | list; optional)

- selectedRowIds (list; optional):
    The ids of the rows the selection covers (read only).

- stickyBottomRows (number; default 0)

- stickyLeftColumns (number; default 0)

- stickyRightColumns (number; default 0)

- stickyTopRows (number; default 0)

- styleHeader (dict; optional)"""
    _children_props: typing.List[str] = []
    _base_nodes = ['children']
    _namespace = 'dash_reactgrid'
    _type = 'DashReactGrid'


    def __init__(
        self,
        id: typing.Optional[typing.Union[str, dict]] = None,
        columns: typing.Optional[typing.Any] = None,
        data: typing.Optional[typing.Any] = None,
        rowIds: typing.Optional[typing.Sequence] = None,
        newRow: typing.Optional[typing.Union[typing.Sequence, dict]] = None,
        lockedCells: typing.Optional[typing.Sequence] = None,
        readOnly: typing.Optional[bool] = None,
        hiddenColumns: typing.Optional[typing.Sequence] = None,
        edits: typing.Optional[dict] = None,
        selectedRowIds: typing.Optional[typing.Sequence] = None,
        stickyLeftColumns: typing.Optional[NumberType] = None,
        stickyRightColumns: typing.Optional[NumberType] = None,
        stickyTopRows: typing.Optional[NumberType] = None,
        stickyBottomRows: typing.Optional[NumberType] = None,
        enableFillHandle: typing.Optional[bool] = None,
        enableRangeSelection: typing.Optional[bool] = None,
        enableRowSelection: typing.Optional[bool] = None,
        enableColumnSelection: typing.Optional[bool] = None,
        highlights: typing.Optional[typing.Any] = None,
        selectedCell: typing.Optional[typing.Any] = None,
        selectedRange: typing.Optional[typing.Any] = None,
        isExtendable: typing.Optional[bool] = None,
        style: typing.Optional[typing.Any] = None,
        styleHeader: typing.Optional[dict] = None,
        className: typing.Optional[str] = None,
        disableVirtualScrolling: typing.Optional[bool] = None,
        dropdownMenuPortal: typing.Optional[bool] = None,
        persistence: typing.Optional[typing.Union[bool, str, NumberType]] = None,
        persistence_type: typing.Optional[Literal["local", "session", "memory"]] = None,
        persisted_props: typing.Optional[typing.Sequence[Literal["columns", "data"]]] = None,
        **kwargs
    ):
        self._prop_names = ['id', 'className', 'columns', 'data', 'disableVirtualScrolling', 'dropdownMenuPortal', 'edits', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'hiddenColumns', 'highlights', 'isExtendable', 'lockedCells', 'newRow', 'persisted_props', 'persistence', 'persistence_type', 'readOnly', 'rowIds', 'selectedCell', 'selectedRange', 'selectedRowIds', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader']
        self._valid_wildcard_attributes =            []
        self.available_properties = ['id', 'className', 'columns', 'data', 'disableVirtualScrolling', 'dropdownMenuPortal', 'edits', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'hiddenColumns', 'highlights', 'isExtendable', 'lockedCells', 'newRow', 'persisted_props', 'persistence', 'persistence_type', 'readOnly', 'rowIds', 'selectedCell', 'selectedRange', 'selectedRowIds', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader']
        self.available_wildcard_properties =            []
        _explicit_args = kwargs.pop('_explicit_args')
        _locals = locals()
        _locals.update(kwargs)  # For wildcard attrs and excess named props
        args = {k: _locals[k] for k in _explicit_args}

        for k in ['columns', 'data']:
            if k not in args:
                raise TypeError(
                    'Required argument `' + k + '` was not specified.')

        super(DashReactGrid, self).__init__(**args)

setattr(DashReactGrid, "__init__", _explicitize_args(DashReactGrid.__init__))
