# AUTO GENERATED FILE - DO NOT EDIT

export dashreactgrid

"""
    dashreactgrid(;kwargs...)

A DashReactGrid component.

Keyword arguments:
- `id` (String | Dict; optional): The ID used to identify this component in Dash callbacks.
- `className` (String; optional)
- `columns` (Bool | Real | String | Dict | Array; required): The columns: `columnId`, `title`, `type` (text, number, percent,
dropdown, checkbox, date or time), and optionally `width`, `align`,
`style`, `headerStyle`, `formatOptions` (Intl.NumberFormat options),
`values` (a dropdown's options), `nonEditable`, `className` (every cell
also has `rg-col-<columnId>`) and
`editableWhen` (rules on the row's other values, see `rulesHold`; a
cell whose rules fail is locked and has the class `rg-cell-na`). A cell
the user can edit has the class `rg-cell-editable`, tinted light blue;
set `--drg-editable-cell-color` to change the tint.
- `data` (Bool | Real | String | Dict | Array; required): The rows, each an array of values in column order.
- `disableVirtualScrolling` (Bool; optional)
- `dropdownMenuPortal` (Bool; optional): Whether dropdown menus render in a portal on the page body, with fixed
positioning, rather than inside their cell. Turn it on when the grid sits
in something that clips or scrolls, such as a card or the grid's own
scroll area, so menus can extend past its edges and show above nearby
content. Off by default, which keeps ReactGrid's own dropdown.
- `edits` (Dict; optional): The edits behind the latest change to `data` (read only): `seq`, which
increases with every change, and `edits`, each one of
`{kind: "cell", rowId, columnId, value}`, `{kind: "add", rowId}` or
`{kind: "remove", rowIds}`.
- `enableColumnSelection` (Bool; optional)
- `enableFillHandle` (Bool; optional)
- `enableRangeSelection` (Bool; optional)
- `enableRowSelection` (Bool; optional)
- `hiddenColumns` (Array; optional): The ids of columns not to show; their values stay in `data`.
- `highlights` (Bool | Real | String | Dict | Array; optional)
- `isExtendable` (Bool; optional): Whether the table shows a blank row after its data, which becomes a new
row once the user types or pastes into it.
- `lockedCells` (Array; optional): Cells the user cannot edit, as `[rowId, columnId]` pairs.
- `newRow` (Array | Dict; optional): The values a row the user adds starts with: an array in column order, or
an object by column id. Blank if omitted.
- `persisted_props` (Array of a value equal to: 'columns', 'data's; optional)
- `persistence` (Bool | String | Real; optional)
- `persistence_type` (a value equal to: 'local', 'session', 'memory'; optional)
- `readOnly` (Bool; optional): Whether every cell is locked, no row can be added and none deleted.
- `virtualRowCount` (optional): Total number of logical rows supplied by the server. Setting a nonnegative integer enables continuous server-side virtualization.
- `virtualDatasetId` (optional): Stable identity of the ordered server dataset; change when sorting, filtering or rebuilding rows to invalidate cached windows.
- `virtualRowHeight` (optional): Fixed row height in pixels, default 25.
- `virtualWindowSize` (optional): Target number of rows to request on each scroll window, default 120.
- `virtualViewportHeight` (optional): Scrollable grid height in pixels, default 420.
- `virtualRequest` (optional): Browser request {datasetId, requestId, start, end}, with zero-based start inclusive and end exclusive.
- `virtualData` (optional): Server response {datasetId, requestId, start, rowIds, data} containing exactly the requested rows, or a matching {error}.
- `rowPageSize` (Real; optional): Maximum data rows displayed per page for very large tables.\n- `rowIds` (Array; optional): An id per row of `data`. Given, edits name rows by these ids, rows the
user adds get ids starting `new-`, and rows can be deleted from the
context menu. Omitted, rows are named by position.
- `selectedCell` (Bool | Real | String | Dict | Array; optional)
- `selectedRange` (Bool | Real | String | Dict | Array; optional)
- `selectedRowIds` (Array; optional): The ids of the rows the selection covers (read only).
- `stickyBottomRows` (Real; optional)
- `stickyLeftColumns` (Real; optional)
- `stickyRightColumns` (Real; optional)
- `stickyTopRows` (Real; optional)
- `style` (Dict; optional): The style of the container (div)
- `styleHeader` (Dict; optional)
"""
function dashreactgrid(; kwargs...)
        available_props = Symbol[:id, :className, :columns, :data, :disableVirtualScrolling, :dropdownMenuPortal, :edits, :enableColumnSelection, :enableFillHandle, :enableRangeSelection, :enableRowSelection, :hiddenColumns, :highlights, :isExtendable, :lockedCells, :newRow, :persisted_props, :persistence, :persistence_type, :readOnly, :rowIds, :rowPageSize, :virtualRowCount, :virtualDatasetId, :virtualRowHeight, :virtualWindowSize, :virtualViewportHeight, :virtualRequest, :virtualData, :selectedCell, :selectedRange, :selectedRowIds, :stickyBottomRows, :stickyLeftColumns, :stickyRightColumns, :stickyTopRows, :style, :styleHeader]
        wild_props = Symbol[]
        return Component("dashreactgrid", "DashReactGrid", "dash_reactgrid", available_props, wild_props; kwargs...)
end

