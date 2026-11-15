import React, { useEffect, useRef } from "react";

/** An Excel-like, grid-local find bar. Enter / Shift+Enter move between matches. */
export const FindBar = ({query, onQuery, onFind, onClose, status, busy, focusToken}) => {
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusToken]);
  return <div className="drg-find" role="search" aria-label="Find in grid"
    onKeyDownCapture={(event) => {
      if (event.key === "Escape") {
        // Search inputs may consume Escape to clear their native value.
        // Close in capture phase so Escape reliably dismisses the toolbar
        // even immediately after Ctrl+F refocuses an existing Find bar.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}
    onKeyDown={(event) => {
      // The parent grid intercepts key presses in capture phase. Stop their
      // ordinary bubbling here for callers that use grid-level bubbling.
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && !event.altKey &&
          event.key.toLowerCase() === "f") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
        return;
      }
      if (event.key === "Enter" && event.target === input.current) {
        event.preventDefault();
        if (!busy && query) onFind(event.shiftKey ? -1 : 1);
      }
    }}>
    <input ref={input} type="search" aria-label="Find text in grid"
      placeholder="Find in grid" maxLength={256} value={query}
      onChange={(event) => onQuery(event.target.value)}/>
    <button type="button" disabled={!query || busy} onClick={() => onFind(-1)}
      aria-label="Find previous">Previous</button>
    <button type="button" disabled={!query || busy} onClick={() => onFind(1)}
      aria-label="Find next">Next</button>
    <span role="status" aria-live="polite" className="drg-find-status">{status}</span>
    <button type="button" onClick={onClose} aria-label="Close find">×</button>
  </div>;
};
