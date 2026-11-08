"""Create DashReactGrid components from pandas/Polars-style dataframes.

Pandas and NumPy remain optional dependencies.  Duplicate and MultiIndex column
labels are mapped to unique edit-safe IDs while visible labels remain intact.
"""
from datetime import date, datetime, time
from math import isfinite

from .column import Column

MAX_SAFE_INTEGER = 2**53 - 1


def _cell_type(dtype):
    if dtype is None:
        return "text"
    name = str(dtype).lower()
    kind = getattr(dtype, "kind", None)
    if kind == "b" or name in {"bool", "boolean"}:
        return "checkbox"
    if kind == "M" or name.startswith(("date", "datetime")):
        return "date"
    if kind in {"i", "u", "f"} or name.startswith(
        ("int", "uint", "float", "double")
    ):
        return "number"
    return "text"


def _normalise(value):
    if value is None or type(value).__name__ in {"NAType", "NaTType"}:
        return None
    # Convert NumPy scalar values before testing primitive Python types.
    if hasattr(value, "item") and type(value).__module__.startswith("numpy"):
        value = value.item()
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, float) and not isfinite(value):
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("Integer values exceed JavaScript's exact integer range")
    if isinstance(value, (str, int, float, bool)):
        return value
    # Preserve exact decimal and other non-native values as text.
    return str(value)


def _option(mapping, position, label):
    if mapping is None:
        return None
    if position in mapping:
        return mapping[position]
    try:
        return mapping.get(label)
    except TypeError:
        return None


def from_dataframe(cls, dataframe, *, include_index=False,
                   column_types=None, column_options=None, **kwargs):
    """Construct a grid from a DataFrame-like object.

    Supports pandas and Polars, as well as objects exposing ``columns`` and
    ``itertuples(index=False, name=None)``, ``iter_rows()``, or ``to_numpy()``.
    A pandas MultiIndex column creates grouped header bands automatically.
    Numeric homogeneous frames retain NumPy's compact binary transport.

    ``column_types`` and ``column_options`` are mappings indexed by the
    original column label (including MultiIndex tuples) or integer position.
    ``include_index=True`` uses pandas' reset_index to display index values.
    Other keyword arguments are forwarded to the DashReactGrid constructor.
    """
    if "columns" in kwargs or "data" in kwargs:
        raise TypeError("from_dataframe generates columns and data")
    if include_index:
        if not callable(getattr(dataframe, "reset_index", None)):
            raise TypeError("include_index requires a DataFrame with reset_index()")
        dataframe = dataframe.reset_index()

    try:
        labels = list(dataframe.columns)
    except (AttributeError, TypeError) as exc:
        raise TypeError("Expected a DataFrame-like object with columns") from exc

    dtypes = getattr(dataframe, "dtypes", None)
    dtypes = list(dtypes) if dtypes is not None else [None] * len(labels)
    if len(dtypes) != len(labels):
        raise ValueError("Number of DataFrame dtypes does not match columns")

    columns = []
    seen = set()
    for i, label in enumerate(labels):
        levels = label if isinstance(label, tuple) else (label,)
        parts = [str(part) for part in levels]
        base = " / ".join(parts) or f"column_{i}"
        column_id = base
        suffix = 2
        while column_id in seen:
            column_id = f"{base}__{suffix}"
            suffix += 1
        inferred = _cell_type(dtypes[i])
        options = dict(_option(column_options, i, label) or {})
        override = _option(column_types, i, label)
        cell_type = options.pop("type", override or inferred)
        title = options.pop("title", parts[-1] if parts else column_id)
        options.setdefault("header_path", parts[:-1])
        column_id = options.pop("column_id", column_id)
        if not isinstance(column_id, str) or not column_id or column_id in seen:
            raise ValueError("Column IDs must be unique, non-empty strings")
        seen.add(column_id)
        columns.append(Column(column_id, title, type=cell_type, **options))

    # Avoid constructing Python cell objects for large homogeneous numeric
    # DataFrames; DashReactGrid's NumPy adapter packs the matrix directly.
    data = None
    if all(col["type"] in {"number", "percent", "checkbox"} for col in columns):
        to_numpy = getattr(dataframe, "to_numpy", None)
        if callable(to_numpy):
            try:
                candidate = to_numpy(copy=False)
            except TypeError:
                candidate = to_numpy()
            if (getattr(candidate, "ndim", None) == 2 and
                    getattr(getattr(candidate, "dtype", None), "kind", None)
                    in {"b", "i", "u", "f"}):
                data = candidate

    if data is None:
        if callable(getattr(dataframe, "itertuples", None)):
            iterator = dataframe.itertuples(index=False, name=None)
        elif callable(getattr(dataframe, "iter_rows", None)):
            iterator = dataframe.iter_rows()
        elif callable(getattr(dataframe, "to_numpy", None)):
            iterator = dataframe.to_numpy().tolist()
        else:
            raise TypeError("Expected a DataFrame-like object with iterable rows")
        data = []
        for row in iterator:
            values = list(row)
            if len(values) != len(columns):
                raise ValueError("DataFrame row width does not match columns")
            data.append([_normalise(value) for value in values])

    return cls(columns=columns, data=data, **kwargs)


def install_dataframe_support(component):
    """Attach the constructor without modifying the generated Dash component."""
    component.from_dataframe = classmethod(from_dataframe)
