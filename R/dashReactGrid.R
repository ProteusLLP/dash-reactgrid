# AUTO GENERATED FILE - DO NOT EDIT

#' @export
dashReactGrid <- function(id=NULL, className=NULL, columns=NULL, data=NULL, disableVirtualScrolling=NULL, enableColumnSelection=NULL, enableFillHandle=NULL, enableRangeSelection=NULL, enableRowSelection=NULL, highlights=NULL, isExtendable=NULL, selectedCell=NULL, stickyBottomRows=NULL, stickyLeftColumns=NULL, stickyRightColumns=NULL, stickyTopRows=NULL, style=NULL, styleHeader=NULL) {
    
    props <- list(id=id, className=className, columns=columns, data=data, disableVirtualScrolling=disableVirtualScrolling, enableColumnSelection=enableColumnSelection, enableFillHandle=enableFillHandle, enableRangeSelection=enableRangeSelection, enableRowSelection=enableRowSelection, highlights=highlights, isExtendable=isExtendable, selectedCell=selectedCell, stickyBottomRows=stickyBottomRows, stickyLeftColumns=stickyLeftColumns, stickyRightColumns=stickyRightColumns, stickyTopRows=stickyTopRows, style=style, styleHeader=styleHeader)
    if (length(props) > 0) {
        props <- props[!vapply(props, is.null, logical(1))]
    }
    component <- list(
        props = props,
        type = 'DashReactGrid',
        namespace = 'dash_reactgrid',
        propNames = c('id', 'className', 'columns', 'data', 'disableVirtualScrolling', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'highlights', 'isExtendable', 'selectedCell', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader'),
        package = 'dashReactgrid'
        )

    structure(component, class = c('dash_component', 'list'))
}
