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
`style`, `headerStyle`, `tooltip` (hover text for the header),
`headerPath` (array of ancestor header labels, displayed as merged
header bands above the leaf title),
`formatOptions` (Intl.NumberFormat options),
`values` (a dropdown's options), `resizable` (true by default),
`nonEditable`, `className` (every cell
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
- `editAck` (Dict; optional): Authoritative server acknowledgement returned from a Dash callback:
{datasetId, streamId, seq, status: "ok" | "retry" | "error" | "conflict", message?}.
Only status "ok" removes the head batch from the durable outbox.
- `editDatasetId` (String; optional): Stable identifier for the authoritative dataset. Required in sparse mode
to recover pending batches across reloads without cross-dataset replay.
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
- `rowIds` (Array; optional): An id per row of `data`. Given, edits name rows by these ids, rows the
user adds get ids starting `new-`, and rows can be deleted from the
context menu. Omitted, rows are named by position.
- `rowPageSize` (Real; optional): Optional maximum data rows shown on one page, e.g. 250. ReactGrid
creates a cell matrix for all supplied rows even with virtual scrolling.
Paging bounds that work for very large datasets; page selection and
clipboard operations refer only to the current page.
The whole data array is still transferred to Dash on edits.
- `selectedCell` (Bool | Real | String | Dict | Array; optional)
- `selectedRange` (Bool | Real | String | Dict | Array; optional)
- `selectedRowIds` (Array; optional): The ids of the rows the selection covers (read only).
- `stickyBottomRows` (Real; optional)
- `stickyLeftColumns` (Real; optional)
- `stickyRightColumns` (Real; optional)
- `stickyTopRows` (Real; optional)
- `style` (Dict; optional): The style of the container (div)
- `styleHeader` (Dict; optional)
- `transmitSparseEdits` (Bool; optional): When true, publish only {edits: {seq, edits}} through setProps.
The changed table is retained locally in the browser, including new
and deleted rows, and is replaced only by an external data/rowIds
update. Default false publishes full data as before.
- `virtualData` (Dict; optional): Server response {datasetId, requestId, start, rowIds, data} or
{datasetId, requestId, start, error}. Must echo the request identity.
- `virtualDatasetId` (String; optional): Stable identifier of the ordered server dataset. Change it when the
sort, filter, contents or revision changes to invalidate cached windows.
- `virtualExportUrl` (String; optional): Application-provided URL for authenticated streamed CSV exports.
- `virtualFindData` (Dict; optional): Search response {datasetId,requestId,query,rowIndex,columnId}, with
null indices when no match, or {datasetId,requestId,query,error}.
- `virtualFindRequest` (Dict; optional): Ctrl+F server search request: {datasetId, requestId, query,
afterRow, afterColumn, direction, columnIds}. The start is exclusive;
search wraps once across all rows, not just the loaded window.
- `virtualRangeData` (Dict; optional): Server response echoing virtualRangeRequest and containing text or error.
Clipboards are limited to a bounded range; large selections use export.
- `virtualRangeRequest` (Dict; optional): Read-only request for preparing clipboard text across unloaded rows:
{datasetId,requestId,start,end,columnStart,columnEnd}.
- `virtualRequest` (Dict; optional): Read-only row request {datasetId, requestId, start, end}. Start inclusive,
end exclusive. Return exactly end-start rows from the backend.
- `virtualRowCount` (Real; optional): Server-backed continuous virtualization: provide the total number of
logical rows; set data=[] and omit rowIds. The client requests bounded
row windows through virtualRequest and receives them in virtualData.
Supplying a nonnegative integer enables virtual mode instead of paging.
- `virtualRowHeight` (Real; optional): Fixed height in pixels of each data row, default 25.
- `virtualSelection` (Dict; optional): Compact absolute-index selection, not an array of every selected row.
- `virtualViewportHeight` (Real; optional): Height in pixels of the scrollable viewport, default 420.
- `virtualWindowSize` (Real; optional): Approximate number of rows fetched per request, default 120.
"""
function dashreactgrid(; kwargs...)
        available_props = Symbol[:id, :className, :columns, :data, :disableVirtualScrolling, :dropdownMenuPortal, :editAck, :editDatasetId, :edits, :enableColumnSelection, :enableFillHandle, :enableRangeSelection, :enableRowSelection, :hiddenColumns, :highlights, :isExtendable, :lockedCells, :newRow, :persisted_props, :persistence, :persistence_type, :readOnly, :rowIds, :rowPageSize, :selectedCell, :selectedRange, :selectedRowIds, :stickyBottomRows, :stickyLeftColumns, :stickyRightColumns, :stickyTopRows, :style, :styleHeader, :transmitSparseEdits, :virtualData, :virtualDatasetId, :virtualExportUrl, :virtualFindData, :virtualFindRequest, :virtualRangeData, :virtualRangeRequest, :virtualRequest, :virtualRowCount, :virtualRowHeight, :virtualSelection, :virtualViewportHeight, :virtualWindowSize]
        wild_props = Symbol[]
        return Component("dashreactgrid", "DashReactGrid", "dash_reactgrid", available_props, wild_props; kwargs...)
end

