# AUTO GENERATED FILE - DO NOT EDIT

#' @export
dashReactGrid <- function(id=NULL, className=NULL, columns=NULL, data=NULL, disableVirtualScrolling=NULL, edits=NULL, enableColumnSelection=NULL, enableFillHandle=NULL, enableRangeSelection=NULL, enableRowSelection=NULL, hiddenColumns=NULL, highlights=NULL, isExtendable=NULL, lockedCells=NULL, newRow=NULL, persisted_props=NULL, persistence=NULL, persistence_type=NULL, readOnly=NULL, rowIds=NULL, selectedCell=NULL, selectedRange=NULL, selectedRowIds=NULL, stickyBottomRows=NULL, stickyLeftColumns=NULL, stickyRightColumns=NULL, stickyTopRows=NULL, style=NULL, styleHeader=NULL) {
    
    props <- list(id=id, className=className, columns=columns, data=data, disableVirtualScrolling=disableVirtualScrolling, edits=edits, enableColumnSelection=enableColumnSelection, enableFillHandle=enableFillHandle, enableRangeSelection=enableRangeSelection, enableRowSelection=enableRowSelection, hiddenColumns=hiddenColumns, highlights=highlights, isExtendable=isExtendable, lockedCells=lockedCells, newRow=newRow, persisted_props=persisted_props, persistence=persistence, persistence_type=persistence_type, readOnly=readOnly, rowIds=rowIds, selectedCell=selectedCell, selectedRange=selectedRange, selectedRowIds=selectedRowIds, stickyBottomRows=stickyBottomRows, stickyLeftColumns=stickyLeftColumns, stickyRightColumns=stickyRightColumns, stickyTopRows=stickyTopRows, style=style, styleHeader=styleHeader)
    if (length(props) > 0) {
        props <- props[!vapply(props, is.null, logical(1))]
    }
    component <- list(
        props = props,
        type = 'DashReactGrid',
        namespace = 'dash_reactgrid',
        propNames = c('id', 'className', 'columns', 'data', 'disableVirtualScrolling', 'edits', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'hiddenColumns', 'highlights', 'isExtendable', 'lockedCells', 'newRow', 'persisted_props', 'persistence', 'persistence_type', 'readOnly', 'rowIds', 'selectedCell', 'selectedRange', 'selectedRowIds', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader'),
        package = 'dashReactgrid'
        )

    structure(component, class = c('dash_component', 'list'))
}
