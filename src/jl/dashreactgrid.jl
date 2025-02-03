# AUTO GENERATED FILE - DO NOT EDIT

export dashreactgrid

"""
    dashreactgrid(;kwargs...)

A DashReactGrid component.
DashReactGrid is a wrapper around the ReactGrid component that allows for easy integration with Dash applications.
Keyword arguments:
- `id` (String; optional): The ID used to identify this component in Dash callbacks
- `className` (String; optional)
- `columns` (Array; required)
- `data` (Array; required)
- `disableVirtualScrolling` (Bool; optional)
- `enableColumnSelection` (Bool; optional)
- `enableFillHandle` (Bool; optional)
- `enableRangeSelection` (Bool; optional)
- `enableRowSelection` (Bool; optional)
- `highlights` (Array; optional)
- `isExtendable` (Bool; optional)
- `persisted_props` (Array; optional)
- `persistence` (Bool | String; optional)
- `persistence_type` (a value equal to: "local", "session", "memory"; optional)
- `selectedCell` (Dict; optional)
- `selectedRange` (Array; optional)
- `stickyBottomRows` (Real; optional)
- `stickyLeftColumns` (Real; optional)
- `stickyRightColumns` (Real; optional)
- `stickyTopRows` (Real; optional)
- `style` (Dict; optional)
- `styleHeader` (Dict; optional)
"""
function dashreactgrid(; kwargs...)
        available_props = Symbol[:id, :className, :columns, :data, :disableVirtualScrolling, :enableColumnSelection, :enableFillHandle, :enableRangeSelection, :enableRowSelection, :highlights, :isExtendable, :persisted_props, :persistence, :persistence_type, :selectedCell, :selectedRange, :stickyBottomRows, :stickyLeftColumns, :stickyRightColumns, :stickyTopRows, :style, :styleHeader]
        wild_props = Symbol[]
        return Component("dashreactgrid", "DashReactGrid", "dash_reactgrid", available_props, wild_props; kwargs...)
end

