% Auto-generated: do not edit by hand
\name{dashReactGrid}

\alias{dashReactGrid}

\title{DashReactGrid component}

\description{

}

\usage{
dashReactGrid(id=NULL, className=NULL, columns=NULL, data=NULL,
  disableVirtualScrolling=NULL, dropdownMenuPortal=NULL, edits=NULL,
  editAck=NULL, editDatasetId=NULL, enableColumnSelection=NULL,
  enableFillHandle=NULL, enableRangeSelection=NULL,
  enableRowSelection=NULL, hiddenColumns=NULL, highlights=NULL,
  isExtendable=NULL, lockedCells=NULL, newRow=NULL, persisted_props=NULL,
  persistence=NULL, persistence_type=NULL, readOnly=NULL, rowIds=NULL,
  rowPageSize=NULL, virtualRowCount=NULL, virtualDatasetId=NULL,
  virtualRowHeight=NULL, virtualWindowSize=NULL,
  virtualViewportHeight=NULL, virtualRequest=NULL, virtualData=NULL,
  virtualRangeRequest=NULL, virtualRangeData=NULL, virtualSelection=NULL,
  virtualExportUrl=NULL, selectedCell=NULL, transmitSparseEdits=NULL,
  selectedRange=NULL, selectedRowIds=NULL, stickyBottomRows=NULL,
  stickyLeftColumns=NULL, stickyRightColumns=NULL, stickyTopRows=NULL,
  style=NULL, styleHeader=NULL, virtualFindRequest=NULL,
  virtualFindData=NULL, virtualClipboardUrl=NULL,
  virtualizationMode=NULL)
}

\arguments{
\item{id}{Character | named list. The ID used to identify this component in Dash callbacks.}

\item{className}{Character. }

\item{columns}{Logical | numeric | character | named list | unnamed list. The columns: `columnId`, `title`, `type` (text, number, percent,
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
set `--drg-editable-cell-color` to change the tint.}

\item{data}{Logical | numeric | character | named list | unnamed list. The rows, each an array of values in column order.}

\item{disableVirtualScrolling}{Logical. }

\item{dropdownMenuPortal}{Logical. Whether dropdown menus render in a portal on the page body, with fixed
positioning, rather than inside their cell. Turn it on when the grid sits
in something that clips or scrolls, such as a card or the grid's own
scroll area, so menus can extend past its edges and show above nearby
content. Off by default, which keeps ReactGrid's own dropdown.}

\item{editAck}{Named list. Authoritative server acknowledgement returned from a Dash callback:
{datasetId, streamId, seq, status: "ok" | "retry" | "error" | "conflict", message?}.
Only status "ok" removes the head batch from the durable outbox.}

\item{editDatasetId}{Character. Stable identifier for the authoritative dataset. Required in sparse mode
to recover pending batches across reloads without cross-dataset replay.}

\item{edits}{Named list. The edits behind the latest change to `data` (read only): `seq`, which
increases with every change, and `edits`, each one of
`{kind: "cell", rowId, columnId, value}`, `{kind: "add", rowId}` or
`{kind: "remove", rowIds}`.}

\item{enableColumnSelection}{Logical. }

\item{enableFillHandle}{Logical. }

\item{enableRangeSelection}{Logical. }

\item{enableRowSelection}{Logical. }

\item{hiddenColumns}{Unnamed list. The ids of columns not to show; their values stay in `data`.}

\item{highlights}{Logical | numeric | character | named list | unnamed list. }

\item{isExtendable}{Logical. Whether the table shows a blank row after its data, which becomes a new
row once the user types or pastes into it.}

\item{lockedCells}{Unnamed list. Cells the user cannot edit, as `[rowId, columnId]` pairs.}

\item{newRow}{Unnamed list | named list. The values a row the user adds starts with: an array in column order, or
an object by column id. Blank if omitted.}

\item{persisted_props}{List of a value equal to: 'columns', 'data's. }

\item{persistence}{Logical | character | numeric. }

\item{persistence_type}{A value equal to: 'local', 'session', 'memory'. }

\item{readOnly}{Logical. Whether every cell is locked, no row can be added and none deleted.}

\item{rowIds}{Unnamed list. An id per row of `data`. Given, edits name rows by these ids, rows the
user adds get ids starting `new-`, and rows can be deleted from the
context menu. Omitted, rows are named by position.}

\item{rowPageSize}{Numeric. Optional maximum data rows shown on one page, e.g. 250. ReactGrid
creates a cell matrix for all supplied rows even with virtual scrolling.
Paging bounds that work for very large datasets; page selection and
clipboard operations refer only to the current page.
The whole data array is still transferred to Dash on edits.}

\item{selectedCell}{Logical | numeric | character | named list | unnamed list. }

\item{selectedRange}{Logical | numeric | character | named list | unnamed list. }

\item{selectedRowIds}{Unnamed list. The ids of the rows the selection covers (read only).}

\item{stickyBottomRows}{Numeric. }

\item{stickyLeftColumns}{Numeric. }

\item{stickyRightColumns}{Numeric. }

\item{stickyTopRows}{Numeric. }

\item{style}{Named list. The style of the container (div)}

\item{styleHeader}{Named list. }

\item{transmitSparseEdits}{Logical. When true, publish only {edits: {seq, edits}} through setProps.
The changed table is retained locally in the browser, including new
and deleted rows, and is replaced only by an external data/rowIds
update. Default false publishes full data as before.}

\item{virtualClipboardUrl}{Character. Authenticated same-origin endpoint streaming selected rows as TSV without a header.}

\item{virtualData}{Named list. Server response {datasetId, requestId, start, rowIds, data} or
{datasetId, requestId, start, error}. Must echo the request identity.}

\item{virtualDatasetId}{Character. Stable identifier of the ordered server dataset. Change it when the
sort, filter, contents or revision changes to invalidate cached windows.}

\item{virtualExportUrl}{Character. Application-provided URL for authenticated streamed CSV exports.}

\item{virtualFindData}{Named list. Search response {datasetId,requestId,query,rowIndex,columnId}, with
null indices when no match, or {datasetId,requestId,query,error}.}

\item{virtualFindRequest}{Named list. Ctrl+F server search request: {datasetId, requestId, query,
afterRow, afterColumn, direction, columnIds}. The start is exclusive;
search wraps once across all rows, not just the loaded window.}

\item{virtualRangeData}{Named list. Server response echoing virtualRangeRequest and containing text or error.
Clipboards are limited to a bounded range; large selections use export.}

\item{virtualRangeRequest}{Named list. Read-only request for preparing clipboard text across unloaded rows:
{datasetId,requestId,start,end,columnStart,columnEnd}.}

\item{virtualRequest}{Named list. Read-only row request {datasetId, requestId, start, end}. Start inclusive,
end exclusive. Return exactly end-start rows from the backend.}

\item{virtualRowCount}{Numeric. Server-backed continuous virtualization: provide the total number of
logical rows; set data=[] and omit rowIds. The client requests bounded
row windows through virtualRequest and receives them in virtualData.
Supplying a nonnegative integer enables virtual mode instead of paging.}

\item{virtualRowHeight}{Numeric. Fixed height in pixels of each data row, default 25.}

\item{virtualSelection}{Named list. Compact absolute-index selection, not an array of every selected row.}

\item{virtualViewportHeight}{Numeric. Height in pixels of the scrollable viewport, default 420.}

\item{virtualWindowSize}{Numeric. Approximate number of rows fetched per request, default 120.}

\item{virtualizationMode}{A value equal to: 'none', 'client', 'server'. 'client' keeps all values in browser memory while mounting bounded rows.
'server' requests windows from Dash. Omitted preserves legacy selection:
server with virtualRowCount, otherwise the conventional in-memory grid.}
}

\value{named list of JSON elements corresponding to React.js properties and their values}

