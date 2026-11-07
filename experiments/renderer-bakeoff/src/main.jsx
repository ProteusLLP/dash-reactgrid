import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Fixture, parseOptions } from "./fixture.js";
import "./styles.css";

const ReactGridAdapter = React.lazy(() => import("./renderers/ReactGridAdapter.jsx"));
const GlideAdapter = React.lazy(() => import("./renderers/GlideAdapter.jsx"));
const RevoAdapter = React.lazy(() => import("./renderers/RevoAdapter.jsx"));
const adapters = { reactgrid: ReactGridAdapter, glide: GlideAdapter, revogrid: RevoAdapter };
const bootTime = performance.now();
const options = parseOptions(window.location.search);

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error: String(error?.stack || error) }; }
  render() { return this.state.error
    ? <pre className="error" data-testid="render-error">{this.state.error}</pre>
    : this.props.children; }
}

function App() {
  const fixture = useMemo(() => new Fixture(options), []);
  const [revision, setRevision] = useState(0);
  const [jump, setJump] = useState(0);
  const [jumpText, setJumpText] = useState("0");
  const [readyMs, setReadyMs] = useState(null);
  const metricsRef = useRef({ created: performance.now(), viewport: null, renderEvents: 0 });
  const Adapter = adapters[options.renderer];

  const commitMany = useCallback(changes => {
    const start = fixture.edits.length;
    for (const change of changes) fixture.write(change.row, change.col, change.value);
    if (fixture.edits.length !== start) setRevision(n => n + 1);
  }, [fixture]);

  const onReady = useCallback(() => {
    if (readyMs !== null) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setReadyMs(performance.now() - bootTime);
      if (window.__bakeoff) window.__bakeoff.ready = true;
    }));
  }, [readyMs]);

  const jumpToRow = useCallback(row => {
    const bounded = Math.max(0, Math.min(fixture.rowCount - 1, Math.floor(Number(row) || 0)));
    setJump(bounded);
    setJumpText(String(bounded));
    return bounded;
  }, [fixture]);

  window.__bakeoff = {
    ready: readyMs !== null,
    renderer: options.renderer,
    read: (row, col) => fixture.get(row, col),
    edits: () => fixture.edits.slice(),
    jump: jumpToRow,
    snapshot: () => ({
      renderer: options.renderer, mode: options.mode,
      rows: fixture.rowCount, cols: fixture.columns.length,
      initializationMs: fixture.initializationMs,
      firstReadyMs: readyMs,
      edits: fixture.edits.length, revision,
      ...metricsRef.current,
    }),
    fixture,
  };

  const setOption = (name, value) => {
    const params = new URLSearchParams(window.location.search);
    params.set(name, String(value));
    window.location.search = params.toString();
  };

  return <main>
    <h1>Renderer bakeoff: Dash ReactGrid</h1>
    <p>Experimental native grid engines. Identical deterministic values, row IDs, edit validation
      and cell edit records. This does not replace or modify the Dash component.</p>
    <div className="toolbar">
      <label>Renderer
        <select data-testid="renderer" value={options.renderer}
          onChange={e => setOption("renderer", e.target.value)}>
          <option value="reactgrid">ReactGrid (bounded window)</option>
          <option value="glide">Glide Data Grid</option>
          <option value="revogrid">RevoGrid</option>
        </select>
      </label>
      <label>Workload
        <select value={options.mode} onChange={e => setOption("mode", e.target.value)}>
          <option value="numeric">Numeric Float64Array</option>
          <option value="mixed">Mixed cell types</option>
        </select>
      </label>
      <label>Rows
        <input aria-label="Rows" value={options.rows} readOnly />
      </label>
      <label>Columns
        <input aria-label="Columns" value={fixture.columns.length} readOnly />
      </label>
      <label>Jump to zero-based row
        <input aria-label="Jump row" value={jumpText}
          onChange={e => setJumpText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") jumpToRow(jumpText); }} />
      </label>
      <button type="button" onClick={() => jumpToRow(jumpText)}>Go to row</button>
    </div>
    <div className="stats">
      <span data-testid="status">Status: {readyMs === null ? "mounting" : "ready"}</span>
      <span data-testid="data-ms">Data preparation: {fixture.initializationMs.toFixed(1)} ms</span>
      <span data-testid="ready-ms">Initial ready: {readyMs?.toFixed(1) ?? "..."} ms</span>
      <span data-testid="edit-count">Sparse edits: {fixture.edits.length}</span>
      <span data-testid="first-cell">A1: {String(fixture.get(0, 0))}</span>
    </div>
    <div data-testid="grid-stage" className="grid-stage">
      <ErrorBoundary key={options.renderer}>
        <Suspense fallback={<p>Loading renderer...</p>}>
          <Adapter fixture={fixture} revision={revision} jumpRow={jump}
            commitMany={commitMany} onReady={onReady} metricsRef={metricsRef} />
        </Suspense>
      </ErrorBoundary>
    </div>
    <pre data-testid="edits" style={{fontSize:12,whiteSpace:"pre-wrap"}}>
      {JSON.stringify(fixture.edits.slice(-5), null, 2)}
    </pre>
    <p className="note">Library differences are intentionally visible. Passing these benchmark
      probes does not establish parity for custom dropdowns, dates, undo/redo, Dash callbacks,
      global clipboard export, or reliable server-backed edits.</p>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
