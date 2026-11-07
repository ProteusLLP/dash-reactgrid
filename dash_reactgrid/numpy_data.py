"""Compact, lossless transport for homogeneous numeric NumPy grid matrices.

Data is row-major little-endian base64 with an explicit dtype and shape. NumPy
is optional; ordinary lists and mixed-type arrays keep the JSON wire format.
The marker belongs only to the wire protocol, never to the table's public API.
"""
import base64
import functools

MARKER = "__dash_reactgrid_ndarray__"
DTYPES = {
    "float32": "float32", "float64": "float64",
    "int8": "int8", "int16": "int16", "int32": "int32",
    "uint8": "uint8", "uint16": "uint16", "uint32": "uint32",
}
MAX_SAFE_INTEGER = 2**53 - 1


def _numpy():
    try:
        import numpy as np
    except ImportError:
        return None
    return np


def is_numpy_array(value):
    """Detect ndarray subclasses without importing NumPy for ordinary lists."""
    if not any(base.__module__ == "numpy" and base.__name__ == "ndarray"
               for base in type(value).__mro__):
        return False
    np = _numpy()
    return np is not None and isinstance(value, np.ndarray)


def encode_numpy_data(data):
    """Encode a 2-D ndarray, or pass through existing JSON-compatible values.

    Float16 is widened to float32. Signed/unsigned 64-bit integers are widened
    to float64 only when every element is exactly representable by JavaScript.
    Non-finite floating point entries are treated as blank cells in the UI.
    Other array dtypes use ordinary nested-list JSON serialization.
    """
    if not is_numpy_array(data):
        return data
    np = _numpy()
    # MaskedArray subclasses ndarray, but casting to an ordinary array
    # silently loses the mask and exposes hidden backing values. The wire
    # format has no validity bitmap, so reject rather than corrupt data.
    if np.ma.isMaskedArray(data):
        raise ValueError(
            "Masked NumPy arrays are not supported; convert masked entries "
            "to NaN (for floating point data) or to explicit nulls in a "
            "nested Python list before passing data to DashReactGrid"
        )
    if data.ndim != 2:
        raise ValueError("Grid data must have two dimensions (rows, columns)")
    rows, cols = map(int, data.shape)
    if data.dtype.kind == "b":
        data = data.astype(np.uint8)
        dtype = "bool"
    elif data.dtype.kind in "iu" and data.dtype.itemsize == 8:
        if data.size and (np.any(data > MAX_SAFE_INTEGER) or
                          (data.dtype.kind == "i" and np.any(data < -MAX_SAFE_INTEGER))):
            raise ValueError("NumPy integer values exceed JavaScript's exact integer range")
        data = data.astype(np.float64)
        dtype = "float64"
    elif data.dtype.kind == "f" and data.dtype.itemsize == 2:
        data = data.astype(np.float32)
        dtype = "float32"
    elif data.dtype.name in DTYPES:
        dtype = DTYPES[data.dtype.name]
    elif data.dtype.kind in "US":
        return data.astype(str).tolist()
    elif data.dtype.kind == "O":
        return data.tolist()
    else:
        raise TypeError("Unsupported NumPy grid dtype: " + str(data.dtype))
    ordered = np.ascontiguousarray(data.astype(data.dtype.newbyteorder("<"), copy=False))
    return {
        MARKER: 1,
        "dtype": dtype,
        "shape": [rows, cols],
        "bdata": base64.b64encode(ordered.tobytes(order="C")).decode("ascii"),
    }


def decode_numpy_data(data):
    """Return an ndarray from the binary wire format, or leave data unchanged."""
    if not isinstance(data, dict) or data.get(MARKER) != 1:
        return data
    np = _numpy()
    if np is None:
        raise ImportError("NumPy is required to decode binary grid data")
    dtype = data.get("dtype")
    if dtype not in (*DTYPES, "bool"):
        raise ValueError("Unsupported binary grid dtype")
    shape = data.get("shape")
    if (not isinstance(shape, list) or len(shape) != 2 or
            any(type(x) is not int or x < 0 for x in shape)):
        raise ValueError("Invalid binary grid shape")
    raw = base64.b64decode(data["bdata"], validate=True)
    native_dtype = np.dtype("uint8" if dtype == "bool" else dtype).newbyteorder("<")
    if len(raw) != shape[0] * shape[1] * native_dtype.itemsize:
        raise ValueError("Binary grid data length does not match its shape")
    array = np.frombuffer(raw, dtype=native_dtype).reshape(shape)
    if dtype == "bool":
        if np.any(array > 1):
            raise ValueError("Invalid binary boolean grid data")
        array = array.astype(bool)
    return array


def install_numpy_support(component):
    """Wrap the generated component constructor without editing generated code."""
    original = component.__init__

    @functools.wraps(original)
    def numpy_init(self, *args, **kwargs):
        if "data" in kwargs:
            kwargs["data"] = encode_numpy_data(kwargs["data"])
        elif len(args) >= 3:
            args = list(args)
            args[2] = encode_numpy_data(args[2])
        original(self, *args, **kwargs)

    component.__init__ = numpy_init
