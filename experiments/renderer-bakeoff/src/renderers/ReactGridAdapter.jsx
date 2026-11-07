import React, { useEffect, useMemo } from "react";
import { ReactGrid } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";

// Control comparison: ReactGrid engine gets a bounded 160-row cell matrix,
// resembling the bounded-window strategy in the actual Dash wrapper.
// This is NOT the production ServerVirtualGrid itself.
const WINDOW = 160;
export default function ReactGridAdapter({ fixture, revision, commitMany, jumpRow, onReady, metricsRef }) {
  const start = Math.min(Math.max(0, fixture.rowCount - WINDOW),
    Math.floor(jumpRow / WINDOW) * WINDOW);
  const columns = useMemo(() => fixture.columns.map(c => ({
    columnId: c.columnId, width: c.width || 120, resizable: true,
  })), [fixture]);

  const rows = useMemo(() => {
    const result = [{ rowId: "header", cells: fixture.columns.map(c => ({
      type: "header", text: c.title,
    })) }];
    for (let row = start; row < Math.min(fixture.rowCount, start + WINDOW); row++) {
      result.push({
        rowId: fixture.rowId(row),
        cells: fixture.columns.map((c, col) => {
          const value = fixture.get(row, col);
          const base = { nonEditable: Boolean(c.nonEditable) };
          if (c.type === "number" || c.type === "percent")
            return { ...base, type: "number", value: value ?? NaN };
          if (c.type === "checkbox")
            return { ...base, type: "checkbox", checked: Boolean(value) };
          return { ...base, type: "text", text: String(value ?? "") };
        }),
      });
    }
    metricsRef.current.materializedRows = result.length - 1;
    return result;
  }, [fixture, start, revision, metricsRef]);

  useEffect(onReady, [onReady]);

  return <div className="engine reactgrid-engine" data-testid="reactgrid-engine">
    <div className="reactgrid-window">Rows {start} to {Math.min(fixture.rowCount, start + WINDOW) - 1}
      {" "}of {fixture.rowCount} (bounded engine comparison)</div>
    <ReactGrid rows={rows} columns={columns} enableRangeSelection
      onCellsChanged={edits => {
        const changes = edits.map(e => ({
          row: Number(String(e.rowId).replace("r-", "")),
          col: fixture.columnIndex(e.columnId),
          value: e.newCell.type === "checkbox" ? e.newCell.checked :
            e.newCell.type === "number" ? e.newCell.value : e.newCell.text,
        }));
        commitMany(changes);
      }} />
  </div>;
}
