/*
 * Server-virtualized clipboard transport. Selection stays a four-boundary
 * descriptor; the response body is assembled by the browser clipboard API,
 * not Dash callbacks or a table of cell objects in React state.
 */
import { selectedColumnIds } from "./virtualOperations.js";

export const clipboardStreamUrl = (base, datasetId, selection, columns) => {
  if (typeof base !== "string" || !base.trim())
    throw new Error("A clipboard streaming endpoint is required");
  if (typeof datasetId !== "string" || !datasetId.trim())
    throw new Error("A non-empty clipboard dataset ID is required");
  if (!selection || !["start","end","columnStart","columnEnd"].every(
      key => Number.isSafeInteger(selection[key])) ||
      selection.start < 0 || selection.end <= selection.start ||
      selection.columnStart < 0 ||
      selection.columnEnd <= selection.columnStart)
    throw new Error("Clipboard selection boundaries must be valid integers");
  if (!Array.isArray(columns) || selection.columnEnd > columns.length)
    throw new Error("Clipboard columns must include the selected visible range");
  const params = new URLSearchParams({
    datasetId, start:String(selection.start), end:String(selection.end),
    columnStart:String(selection.columnStart),
    columnEnd:String(selection.columnEnd),
    columnIds:JSON.stringify(selectedColumnIds(selection, columns)),
  });
  return base + (base.includes("?") ? "&" : "?") + params.toString();
};

/**
 * Must be called synchronously from a trusted user gesture (Ctrl+C or click).
 * Promise<Blob> in ClipboardItem lets the server stream after write() begins,
 * without losing transient clipboard activation during an awaited fetch.
 */
export const writeStreamedClipboard = ({
  url, clipboard, ClipboardItemCtor, fetcher,
}) => {
  if (!clipboard?.write || !ClipboardItemCtor || !fetcher)
    throw new Error("Clipboard streaming is not supported in this browser");
  const payload = fetcher(url, {credentials:"same-origin"}).then(async response => {
    if (!response.ok)
      throw new Error("Clipboard export failed (HTTP " + response.status + ")");
    const blob = await response.blob();
    return blob.type.startsWith("text/plain") ?
      blob : new Blob([blob], {type:"text/plain"});
  });
  const item = new ClipboardItemCtor({"text/plain":payload});
  return clipboard.write([item]);
};
