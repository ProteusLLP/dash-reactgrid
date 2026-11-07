import React, { useCallback, useEffect, useMemo, useRef } from "react";
import DataEditor, { GridCellKind } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";

export default function GlideAdapter({ fixture, commitMany, onReady, jumpRow, metricsRef }) {
  const ref = useRef(null);
  const columns = useMemo(() => fixture.columns.map(c => ({
    id: c.columnId, title: c.title, width: c.width || 120,
  })), [fixture]);

  const getCellContent = useCallback(([col, row]) => {
    const column = fixture.columns[col];
    if (!column || row < 0 || row >= fixture.rowCount)
      return { kind: GridCellKind.Loading, allowOverlay: false };
    const value = fixture.get(row, col);
    const readonly = Boolean(column.nonEditable);
    if (column.type === "checkbox") return {
      kind: GridCellKind.Boolean, data: Boolean(value), allowOverlay: false,
      readonly, copyData: value ? "TRUE" : "FALSE",
    };
    if (column.type === "number" || column.type === "percent") {
      const formatted = value === null ? "" :
        column.type === "percent" ? (value * 100).toFixed(2) + "%" : String(value);
      return { kind: GridCellKind.Number, data: value ?? undefined,
        displayData: formatted, allowOverlay: !readonly, readonly,
        copyData: value === null ? "" : String(value) };
    }
    const text = String(value ?? "");
    return { kind: GridCellKind.Text, data: text,
      displayData: text, allowOverlay: !readonly, readonly, copyData: text };
  }, [fixture]);

  const onCellsEdited = useCallback(edits => {
    const changes = edits.map(({ location: [col, row], value }) => ({
      col, row, value: value.data,
    }));
    commitMany(changes);
    ref.current?.updateCells?.(edits.map(({ location }) => ({ cell: location })));
    return true;
  }, [commitMany]);

  const selection = useCallback(rect => {
    // Bound clipboard materialisation, matching our existing server clipboard limits.
    if (rect.width * rect.height > 20_000 || rect.height > 1_000) return [];
    return Array.from({ length: rect.height }, (_, r) =>
      Array.from({ length: rect.width }, (_, c) =>
        getCellContent([rect.x + c, rect.y + r])));
  }, [getCellContent]);

  useEffect(() => {
    ref.current?.scrollTo?.(0, jumpRow, "vertical");
  }, [jumpRow]);
  useEffect(onReady, [onReady]);

  return <div className="engine" data-testid="glide-engine">
    <DataEditor ref={ref} columns={columns} rows={fixture.rowCount}
      width="100%" height={445} rowHeight={28} headerHeight={32}
      getCellContent={getCellContent} getCellsForSelection={selection}
      onCellsEdited={onCellsEdited} onPaste={true} fillHandle={true}
      onVisibleRegionChanged={rect => {
        metricsRef.current.viewport = { row: rect.y, height: rect.height };
        metricsRef.current.renderEvents++;
      }}
      smoothScrollY={false} />
  </div>;
}
