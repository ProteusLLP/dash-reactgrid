% Auto-generated: do not edit by hand
\name{dashReactGrid}

\alias{dashReactGrid}

\title{DashReactGrid component}

\description{

}

\usage{
dashReactGrid(id=NULL, className=NULL, columns=NULL, data=NULL,
disableVirtualScrolling=NULL, dropdownMenuPortal=NULL,
edits=NULL, enableColumnSelection=NULL,
enableFillHandle=NULL, enableRangeSelection=NULL,
enableRowSelection=NULL, hiddenColumns=NULL,
highlights=NULL, isExtendable=NULL, lockedCells=NULL,
newRow=NULL, persisted_props=NULL, persistence=NULL,
persistence_type=NULL, readOnly=NULL, rowIds=NULL,
selectedCell=NULL, selectedRange=NULL, selectedRowIds=NULL,
stickyBottomRows=NULL, stickyLeftColumns=NULL,
stickyRightColumns=NULL, stickyTopRows=NULL, style=NULL,
styleHeader=NULL)
}

\arguments{
\item{id}{Character | named list. The ID used to identify this component in Dash callbacks.}

\item{className}{Character. }

\item{columns}{Logical | numeric | character | named list | unnamed list. The columns: `columnId`, `title`, `type` (text, number, percent,
dropdown, checkbox, date or time), and optionally `width`, `align`,
`style`, `headerStyle`, `formatOptions` (Intl.NumberFormat options),
`values` (a dropdown's options), `nonEditable`, `className` (every cell
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

\item{selectedCell}{Logical | numeric | character | named list | unnamed list. }

\item{selectedRange}{Logical | numeric | character | named list | unnamed list. }

\item{selectedRowIds}{Unnamed list. The ids of the rows the selection covers (read only).}

\item{stickyBottomRows}{Numeric. }

\item{stickyLeftColumns}{Numeric. }

\item{stickyRightColumns}{Numeric. }

\item{stickyTopRows}{Numeric. }

\item{style}{Named list. The style of the container (div)}

\item{styleHeader}{Named list. }
}

\value{named list of JSON elements corresponding to React.js properties and their values}

