/** Keep native text-editing shortcuts inside the active cell editor.
 *
 * ReactGrid uses Ctrl/Cmd+A and Ctrl/Cmd+Z at grid level. Within an editor,
 * the same shortcuts must use the browser's input selection and undo buffer.
 * Stopping propagation without preventing default is essential.
 */
export const nativeEditorShortcut = (event) =>
  Boolean((event.ctrlKey || event.metaKey) && !event.altKey &&
    ["a", "c", "v", "x", "z", "y"].includes(String(event.key || "").toLowerCase()));
