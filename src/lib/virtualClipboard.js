/*
 * Server-virtualized clipboard transport. Selection stays a four-boundary
 * descriptor; the response body is assembled by the browser clipboard API,
 * not Dash callbacks or a table of cell objects in React state.
 */
import { selectedColumnIds } from "./virtualOperations.js";

export const clipboardStreamUrl = (base, datasetId, selection, columns) => {
  if (typeof base !== "string" || !base.trim() || !selection)
    throw new Error("Clipboard streaming endpoint and selection are required");
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
    throw new Error("This browser cannot stream to the clipboard. Use Download CSV.");
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
