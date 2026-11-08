"""Pure adapters for DashReactGrid's server-virtualized request/response contract.

No database, session, cache, global variables, background jobs or persistence.
The host application injects a row provider and an edit-command handler.
These helpers never retain the dataset or modify the application's state.

For reliable edits, the supplied handler must atomically commit commands
and deduplicate replayed (datasetId, streamId, seq) identities in the
*application's own authoritative data source*. Stateless HTTP callbacks alone
cannot promise exactly-once delivery after a lost acknowledgement.
"""
import csv
import io

DEFAULT_MAX_WINDOW_ROWS = 1000
DEFAULT_MAX_CLIPBOARD_ROWS = 1000
DEFAULT_MAX_CLIPBOARD_BYTES = 1_000_000


def _bounded_int(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{label} must be an integer between {low} and {high}")
    return value


def _dataset(request, dataset_id):
    if not isinstance(request, dict) or request.get("datasetId") != dataset_id:
        raise ValueError("Unexpected dataset identity")
    return request


def _valid_rows(result, expected, width, *, encode=False):
    if not isinstance(result, dict):
        raise ValueError("The provider must return a rowIds/data dictionary")
    ids, rows = result.get("rowIds"), result.get("data")
    # A numeric viewport can be a NumPy matrix. It remains binary for
    # window_response; clipboard/export materialize only the bounded window.
    ndarray = any(base.__module__ == "numpy" and base.__name__ == "ndarray"
                  for base in type(rows).__mro__)
    if ndarray:
        import numpy as np
        ndarray = isinstance(rows, np.ndarray)
    if not isinstance(ids, list) or (not isinstance(rows, list) and not ndarray):
        raise ValueError("The provider must return rowIds and data arrays")
    if len(ids) != expected or len(rows) != expected:
        raise ValueError("The provider returned the wrong number of rows")
    if ndarray:
        if rows.ndim != 2 or rows.shape[1] != width:
            raise ValueError("The provider returned rows with an invalid width")
    elif any(not isinstance(row, list) or len(row) != width for row in rows):
        raise ValueError("The provider returned rows with an invalid width")
    if any(isinstance(row_id, bool) or
           (not isinstance(row_id, str) and
            (not isinstance(row_id, int) or not -(2**53 - 1) <= row_id <= 2**53 - 1))
           for row_id in ids):
        raise ValueError("Row IDs must be strings or JavaScript-safe integers; encode large IDs as strings")
    if len(set(ids)) != len(ids):
        raise ValueError("A row window contains duplicate IDs")
    if ndarray:
        if encode:
            from dash_reactgrid.numpy_data import encode_numpy_data
            rows = encode_numpy_data(rows)
        else:
            rows = rows.tolist()
    return {"rowIds": ids, "data": rows}


def _column_selection(columns, first, last, column_ids=None):
    """Resolve visible column IDs against the original full-data row layout."""
    names = [col["columnId"] if isinstance(col, dict) else str(col)
             for col in columns]
    if column_ids is None:
        return list(range(first, last)), names[first:last]
    if (not isinstance(column_ids, list) or not column_ids or
        any(not isinstance(name, str) for name in column_ids) or
        len(set(column_ids)) != len(column_ids) or
        len(set(names)) != len(names) or
        len(column_ids) != last - first or
        any(name not in names for name in column_ids)):
        raise ValueError("Clipboard/export columnIds must match unique column IDs in the provider")
    return [names.index(name) for name in column_ids], column_ids


def window_response(request, *, dataset_id, row_count, columns, fetch_rows,
                    max_rows=DEFAULT_MAX_WINDOW_ROWS):
    """Resolve a bounded viewport from any user-supplied data source.

    fetch_rows(start, end) -> {"rowIds": [...], "data": [[...], ...]}
    Offsets are zero-based, start inclusive and end exclusive.
    """
    request = _dataset(request, dataset_id)
    count = _bounded_int(row_count, "row_count", 0, 2**53 - 1)
    start = _bounded_int(request.get("start"), "start", 0, count)
    end = _bounded_int(request.get("end"), "end", start, count)
    if not 0 < end - start <= max_rows:
        raise ValueError("Requested viewport exceeds its bounded row limit")
    result = _valid_rows(fetch_rows(start, end), end - start, len(columns),
                         encode=True)
    return {"datasetId": dataset_id, "requestId": request.get("requestId"),
            "start": start, **result}


def clipboard_response(request, *, dataset_id, row_count, columns, fetch_rows,
                       max_rows=DEFAULT_MAX_CLIPBOARD_ROWS,
                       max_bytes=DEFAULT_MAX_CLIPBOARD_BYTES):
    """Prepare TSV for a bounded absolute selection without server-side state."""
    request = _dataset(request, dataset_id)
    count = _bounded_int(row_count, "row_count", 0, 2**53 - 1)
    start = _bounded_int(request.get("start"), "start", 0, count)
    end = _bounded_int(request.get("end"), "end", start, count)
    first = _bounded_int(request.get("columnStart"), "columnStart", 0, len(columns))
    last = _bounded_int(request.get("columnEnd"), "columnEnd", first, len(columns))
    if not 0 < end - start <= max_rows or not first < last:
        raise ValueError("Clipboard selection exceeds supported bounds")
    indices, names = _column_selection(
        columns, first, last, request.get("columnIds"))
    result = _valid_rows(fetch_rows(start, end), end - start, len(columns))
    buffer = io.StringIO()
    byte_count = 0
    for values in result["data"]:
        line = io.StringIO()
        writer = csv.writer(line, delimiter="\t", lineterminator="\n")
        writer.writerow(["" if values[i] is None else str(values[i]) for i in indices])
        serialized = line.getvalue()
        byte_count += len(serialized.encode("utf-8"))
        if byte_count > max_bytes:
            raise ValueError("Clipboard data too large; use a streamed export")
        buffer.write(serialized)
    response = {k: request[k] for k in (
        "datasetId", "requestId", "start", "end", "columnStart", "columnEnd"
    )}
    if "columnIds" in request:
        response["columnIds"] = names
    return {**response, "text": buffer.getvalue().rstrip("\n")}


def csv_chunks(*, start, end, column_start, column_end, row_count, columns,
               fetch_rows, chunk_size=250, column_ids=None):
    """Generate CSV chunks with bounded memory, independent of the source."""
    count = _bounded_int(row_count, "row_count", 0, 2**53 - 1)
    start = _bounded_int(start, "start", 0, count)
    end = _bounded_int(end, "end", start, count)
    first = _bounded_int(column_start, "column_start", 0, len(columns))
    last = _bounded_int(column_end, "column_end", first, len(columns))
    if start >= end or first >= last or not 1 <= chunk_size <= DEFAULT_MAX_WINDOW_ROWS:
        raise ValueError("Invalid CSV export range or chunk size")
    indices, names = _column_selection(columns, first, last, column_ids)
    header = io.StringIO()
    writer = csv.writer(header)
    writer.writerow(names)
    yield header.getvalue()
    for position in range(start, end, chunk_size):
        stop = min(position + chunk_size, end)
        result = _valid_rows(fetch_rows(position, stop), stop - position, len(columns))
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        for row in result["data"]:
            writer.writerow([row[i] for i in indices])
        yield buffer.getvalue()


def tsv_chunks(*, start, end, column_start, column_end, row_count, columns,
               fetch_rows, chunk_size=250, column_ids=None):
    """Yield Excel-compatible tab-separated rows, without a header.

    Each provider call is bounded to chunk_size rows; this function does not
    construct a full selection or retain server-side state. The caller must
    authorise the current user and dataset before serving the stream.
    """
    count = _bounded_int(row_count, "row_count", 0, 2**53 - 1)
    start = _bounded_int(start, "start", 0, count)
    end = _bounded_int(end, "end", start, count)
    first = _bounded_int(column_start, "column_start", 0, len(columns))
    last = _bounded_int(column_end, "column_end", first, len(columns))
    if start >= end or first >= last or not 1 <= chunk_size <= DEFAULT_MAX_WINDOW_ROWS:
        raise ValueError("Invalid TSV export range or chunk size")
    indices, _ = _column_selection(columns, first, last, column_ids)
    for position in range(start, end, chunk_size):
        stop = min(position + chunk_size, end)
        result = _valid_rows(fetch_rows(position, stop), stop - position, len(columns))
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter="\\t", lineterminator="\\r\\n")
        for row in result["data"]:
            writer.writerow(["" if row[i] is None else str(row[i]) for i in indices])
        text = buffer.getvalue()
        # A trailing row separator would add an empty row in some paste targets.
        yield text[:-2] if stop == end and text.endswith("\\r\\n") else text


def edit_ack(batch, *, dataset_id, apply_batch):
    """Forward an edit command to an application-defined commit function.

    apply_batch(batch) must apply edits atomically, deduplicate retries and
    return {"status":"ok", "rowCount":..., "revision":...} only after commit.
    Error/retry/conflict returns need a reason. No state lives here.
    """
    if not isinstance(batch, dict):
        raise ValueError("Edit batch must be a dictionary")
    identity = {key: batch.get(key) for key in ("datasetId", "streamId", "seq")}
    if (identity["datasetId"] != dataset_id or
        not isinstance(identity["streamId"], str) or not identity["streamId"] or
        isinstance(identity["seq"], bool) or not isinstance(identity["seq"], int) or
        identity["seq"] < 1 or not isinstance(batch.get("edits"), list) or
        not batch["edits"]):
        return {**identity, "status": "conflict", "message": "Invalid command identity or edits"}
    result = apply_batch(batch)
    if not isinstance(result, dict) or result.get("status") not in (
        "ok", "retry", "error", "conflict"
    ):
        raise ValueError("Edit handler must return a recognised status")
    if result["status"] == "ok":
        if (isinstance(result.get("rowCount"), bool) or
            not isinstance(result.get("rowCount"), int) or result["rowCount"] < 0 or
            isinstance(result.get("revision"), bool) or
            not isinstance(result.get("revision"), int) or result["revision"] < 0):
            raise ValueError("Successful commits must return rowCount and revision")
    return {**identity, **result}
