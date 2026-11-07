import React, { useEffect, useMemo, useRef } from "react";
import { RevoGrid } from "@revolist/react-datagrid";

export default function RevoAdapter({ fixture, commitMany, jumpRow, onReady, metricsRef }) {
  const ref = useRef(null);
  const preparation = useMemo(() => {
    // RevoGrid's ordinary React source is a complete row-array. This cost is
    // measured separately from painting, unlike Glide's lazy cell callback.
    const start = performance.now();
    const source = fixture.rows();
    metricsRef.current.sourcePreparationMs = performance.now() - start;
    metricsRef.current.materializedRows = source.length;
    return source;
  }, [fixture, metricsRef]);
  const columns = useMemo(() => fixture.columns.map(c => ({
    prop: c.columnId, name: c.title, size: c.width || 120,
    readonly: Boolean(c.nonEditable),
  })), [fixture]);

  useEffect(() => {
    void ref.current?.scrollToRow?.(jumpRow);
  }, [jumpRow]);
  useEffect(onReady, [onReady]);

  const onAfteredit = e => {
    const payload = e.detail;
    const edits = Array.isArray(payload) ? payload : [payload];
    const changes = edits.filter(x => x?.model && x.prop !== undefined)
      .map(x => ({
        row: x.model.__row, col: fixture.columnIndex(x.prop), value: x.val,
      }));
    if (changes.length) commitMany(changes);
    metricsRef.current.editEvents = (metricsRef.current.editEvents || 0) + 1;
  };

  return <div className="engine revo-engine" data-testid="revo-engine">
    <RevoGrid ref={ref} columns={columns} source={preparation}
      rowSize={28} theme="material" stretch={false}
      onBeforeedit={e => {
        const def = fixture.columns.find(c => c.columnId === e.detail?.prop);
        if (def?.nonEditable) e.preventDefault();
      }}
      onAfteredit={onAfteredit}
      style={{height:"445px",width:"100%"}} />
  </div>;
}
