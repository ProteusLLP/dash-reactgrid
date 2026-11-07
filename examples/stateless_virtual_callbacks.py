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
import json

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


def _valid_rows(result, expected, width):
    if not isinstance(result, dict):
        raise ValueError("The provider must return a rowIds/data dictionary")
    ids, rows = result.get("rowIds"), result.get("data")
    if not isinstance(ids, list) or not isinstance(rows, list):
        raise ValueError("The provider must return rowIds and data arrays")
    if len(ids) != expected or len(rows) != expected:
        raise ValueError("The provider returned the wrong number of rows")
    if any(not isinstance(row, list) or len(row) != width for row in rows):
        raise ValueError("The provider returned rows with an invalid width")
    if any(isinstance(row_id, bool) or not isinstance(row_id, (str, int)) for row_id in ids):
        raise ValueError("Row IDs must be stable strings or integers")
    if len(set(ids)) != len(ids):
        raise ValueError("A row window contains duplicate IDs")
    return {"rowIds": ids, "data": rows}


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
    result = _valid_rows(fetch_rows(start, end), end - start, len(columns))
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
    result = _valid_rows(fetch_rows(start, end), end - start, len(columns))
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    for values in result["data"]:
        writer.writerow(["" if v is None else str(v) for v in values[first:last]])
        if buffer.tell() > max_bytes:
            raise ValueError("Clipboard data too large; use a streamed export")
    return {k: request[k] for k in (
        "datasetId", "requestId", "start", "end", "columnStart", "columnEnd"
    )} | {"text": buffer.getvalue().rstrip("\n")}


def csv_chunks(*, start, end, column_start, column_end, row_count, columns,
               fetch_rows, chunk_size=250):
    """Generate CSV chunks with bounded memory, independent of the source."""
    count = _bounded_int(row_count, "row_count", 0, 2**53 - 1)
    start = _bounded_int(start, "start", 0, count)
    end = _bounded_int(end, "end", start, count)
    first = _bounded_int(column_start, "column_start", 0, len(columns))
    last = _bounded_int(column_end, "column_end", first, len(columns))
    if start >= end or first >= last or not 1 <= chunk_size <= DEFAULT_MAX_WINDOW_ROWS:
        raise ValueError("Invalid CSV export range or chunk size")
    header = io.StringIO()
    writer = csv.writer(header)
    writer.writerow([
        col["columnId"] if isinstance(col, dict) else str(col)
        for col in columns[first:last]
    ])
    yield header.getvalue()
    for position in range(start, end, chunk_size):
        stop = min(position + chunk_size, end)
        result = _valid_rows(fetch_rows(position, stop), stop - position, len(columns))
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        for row in result["data"]:
            writer.writerow(row[first:last])
        yield buffer.getvalue()


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
