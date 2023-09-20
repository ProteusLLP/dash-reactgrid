# AUTO GENERATED FILE - DO NOT EDIT

from dash.development.base_component import Component, _explicitize_args


class DashReactGrid(Component):
    """A DashReactGrid component.


Keyword arguments:

- id (string; optional):
    The ID used to identify this component in Dash callbacks.

- columns (boolean | number | string | dict | list; required):
    A label that will be printed when this component is rendered.

- data (boolean | number | string | dict | list; required):
    The value displayed in the input.

- enableColumnSelection (boolean; default True)

- enableFillHandle (boolean; default True)

- enableRangeSelection (boolean; default True)

- enableRowSelection (boolean; default True)

- highlights (boolean | number | string | dict | list; optional)

- selectedCell (boolean | number | string | dict | list; optional)

- stickyBottomRows (number; default 0)

- stickyLeftColumns (number; default 0)

- stickyRightColumns (number; default 0)

- stickyTopRows (number; default 0)

- style (dict; optional):
    The style of the container (div).

- styleHeader (dict; optional)"""
    _children_props = []
    _base_nodes = ['children']
    _namespace = 'dash_reactgrid'
    _type = 'DashReactGrid'
    @_explicitize_args
    def __init__(self, id=Component.UNDEFINED, columns=Component.REQUIRED, data=Component.REQUIRED, stickyLeftColumns=Component.UNDEFINED, stickyRightColumns=Component.UNDEFINED, stickyTopRows=Component.UNDEFINED, stickyBottomRows=Component.UNDEFINED, enableFillHandle=Component.UNDEFINED, enableRangeSelection=Component.UNDEFINED, enableRowSelection=Component.UNDEFINED, enableColumnSelection=Component.UNDEFINED, highlights=Component.UNDEFINED, selectedCell=Component.UNDEFINED, style=Component.UNDEFINED, styleHeader=Component.UNDEFINED, **kwargs):
        self._prop_names = ['id', 'columns', 'data', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'highlights', 'selectedCell', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader']
        self._valid_wildcard_attributes =            []
        self.available_properties = ['id', 'columns', 'data', 'enableColumnSelection', 'enableFillHandle', 'enableRangeSelection', 'enableRowSelection', 'highlights', 'selectedCell', 'stickyBottomRows', 'stickyLeftColumns', 'stickyRightColumns', 'stickyTopRows', 'style', 'styleHeader']
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
