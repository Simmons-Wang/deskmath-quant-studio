"use client";

import { Eye, Headphones, TrendingUp } from "lucide-react";
import {
  ERROR_CATEGORY_LABEL,
  OP_LABEL,
  OP_SYMBOL,
  type OverviewStats,
} from "@/lib/math";

interface AnalyticsWorkbenchProps {
  overview: OverviewStats | null;
  onInspectSession: (sessionId: string) => void;
}

export function AnalyticsWorkbench({
  overview,
  onInspectSession,
}: AnalyticsWorkbenchProps) {
  if (!overview) {
    return (
      <section className="panel">
        <p className="hint">Loading analytics…</p>
      </section>
    );
  }

  const maxOpLatency = Math.max(1000, ...overview.opStats.map((s) => s.meanMs));
  const chronoSessions = [...overview.recentSessions].reverse();
  const maxPpm = Math.max(20, ...chronoSessions.map((s) => s.ppm));
  const chartW = 560;
  const chartH = 160;
  const padX = 28;
  const padY = 18;

  const points = chronoSessions.map((s, idx) => {
    const x =
      chronoSessions.length <= 1
        ? chartW / 2
        : padX + (idx / (chronoSessions.length - 1)) * (chartW - padX * 2);
    const y = chartH - padY - (s.ppm / maxPpm) * (chartH - padY * 2);
    return { x, y, session: s };
  });

  const polyline = points
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const visualStat = overview.modeStats.find((m) => m.bucket === "visual");
  const voiceStat = overview.modeStats.find((m) => m.bucket === "voice");

  return (
    <div className="stack-lg">
      <section className="hud-strip" aria-label="Overall quant readiness metrics">
        <div className="hud-metric">
          <span className="hud-label">Sessions</span>
          <span className="hud-value tabular">{overview.totalSessions}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">Total Problems</span>
          <span className="hud-value tabular">{overview.totalAttempts}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">Accuracy</span>
          <span className="hud-value tabular">
            {overview.overallAccuracyPct}%
          </span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">Mean Speed</span>
          <span className="hud-value tabular">
            {overview.overallMeanMs > 0
              ? `${(overview.overallMeanMs / 1000).toFixed(2)}s`
              : "—"}
          </span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">Peak Throughput</span>
          <span className="hud-value tabular">{overview.bestPpm} Q/min</span>
        </div>
        <div className="hud-metric">
          <span className="hud-label">Unreviewed Issues</span>
          <span className="hud-value tabular">
            {overview.unreviewedIssuesCount}
          </span>
        </div>
      </section>

      <div className="auto-card-grid">
        <section className="panel" aria-labelledby="op-breakdown-heading">
          <h2 id="op-breakdown-heading" className="section-title">
            Speed &amp; Accuracy by Operation
          </h2>
          <p className="section-sub" style={{ marginBlockEnd: "1rem" }}>
            Identify which operation slows down your desk throughput.
          </p>
          <div style={{ display: "grid", gap: "0.85rem" }}>
            {overview.opStats.map((stat) => {
              const pctWidth =
                stat.total > 0
                  ? Math.max(8, Math.round((stat.meanMs / maxOpLatency) * 100))
                  : 0;
              return (
                <div key={stat.op} className="bar-row">
                  <div className="bar-head">
                    <span>
                      <strong className="mono">{OP_SYMBOL[stat.op]}</strong>{" "}
                      {OP_LABEL[stat.op]}{" "}
                      <span className="hint">({stat.total} Q)</span>
                    </span>
                    <span className="mono">
                      {stat.total > 0
                        ? `${(stat.meanMs / 1000).toFixed(2)}s · p90 ${(stat.p90Ms / 1000).toFixed(2)}s · ${stat.accuracyPct}%`
                        : "No data"}
                    </span>
                  </div>
                  <div className="bar-track" aria-hidden="true">
                    <div
                      className="bar-fill"
                      style={{ width: `${pctWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-labelledby="mode-compare-heading">
          <h2 id="mode-compare-heading" className="section-title">
            Visual vs Voice Latency Benchmark
          </h2>
          <p className="section-sub" style={{ marginBlockEnd: "1rem" }}>
            Voice mode separates total response time from post-speech processing
            latency.
          </p>

          <div style={{ display: "grid", gap: "0.8rem" }}>
            <div
              className="panel-subtle"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
              >
                <Eye size={18} aria-hidden="true" />
                <div>
                  <strong>Visual Mode</strong>
                  <div className="hint">{visualStat?.total ?? 0} problems</div>
                </div>
              </div>
              <div style={{ textAlign: "end" }} className="mono">
                <strong>
                  {visualStat && visualStat.total > 0
                    ? `${(visualStat.meanMs / 1000).toFixed(2)}s`
                    : "—"}
                </strong>
                <div className="hint">{visualStat?.accuracyPct ?? 0}% acc</div>
              </div>
            </div>

            <div
              className="panel-subtle"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
              >
                <Headphones size={18} aria-hidden="true" />
                <div>
                  <strong>Voice Modes</strong>
                  <div className="hint">{voiceStat?.total ?? 0} problems</div>
                </div>
              </div>
              <div style={{ textAlign: "end" }} className="mono">
                <strong>
                  {voiceStat && voiceStat.total > 0
                    ? `${(voiceStat.meanMs / 1000).toFixed(2)}s total`
                    : "—"}
                </strong>
                <div className="hint">
                  {voiceStat?.meanProcessingMs !== null &&
                  voiceStat?.meanProcessingMs !== undefined
                    ? `${(voiceStat.meanProcessingMs / 1000).toFixed(2)}s post-speech · `
                    : ""}
                  {voiceStat?.accuracyPct ?? 0}% acc
                </div>
              </div>
            </div>

            {overview.errorBreakdown.length > 0 && (
              <div className="panel-subtle">
                <strong
                  style={{
                    fontSize: "0.85rem",
                    display: "block",
                    marginBlockEnd: "0.45rem",
                  }}
                >
                  Top Mistake &amp; Slowdown Causes
                </strong>
                <div className="badge-row">
                  {overview.errorBreakdown.slice(0, 5).map((e) => (
                    <span key={e.category} className="status-pill is-neutral">
                      {ERROR_CATEGORY_LABEL[e.category]}:{" "}
                      <strong className="mono">{e.count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="trend-heading">
        <div className="section-header">
          <h2
            id="trend-heading"
            className="section-title"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <TrendingUp size={18} aria-hidden="true" /> Session Throughput Trend
            (Q / min)
          </h2>
        </div>
        {chronoSessions.length === 0 ? (
          <p className="hint">
            Complete at least one drill session to plot your throughput curve.
          </p>
        ) : (
          <figure style={{ margin: 0 }}>
            <svg
              role="img"
              aria-label={`Throughput trend across last ${chronoSessions.length} sessions, peak ${overview.bestPpm} questions per minute`}
              viewBox={`0 0 ${chartW} ${chartH}`}
              style={{
                inlineSize: "100%",
                maxInlineSize: "760px",
                blockSize: "auto",
                display: "block",
              }}
            >
              <line
                x1={padX}
                y1={chartH - padY}
                x2={chartW - padX}
                y2={chartH - padY}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <line
                x1={padX}
                y1={padY}
                x2={chartW - padX}
                y2={padY}
                stroke="var(--border)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              {points.length > 1 && (
                <polyline
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  points={polyline}
                />
              )}
              {points.map((pt) => (
                <g key={pt.session.id}>
                  <circle cx={pt.x} cy={pt.y} r="4.5" fill="var(--accent)" />
                  <text
                    x={pt.x}
                    y={pt.y - 9}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--text-secondary)"
                    fontFamily="var(--font-mono)"
                  >
                    {pt.session.ppm}
                  </text>
                </g>
              ))}
            </svg>
            <figcaption className="hint" style={{ marginBlockStart: "0.35rem" }}>
              Chronological problems-per-minute (Q/min) over your latest{" "}
              {chronoSessions.length} logged sessions.
            </figcaption>
          </figure>
        )}
      </section>

      <section className="panel" aria-labelledby="sessions-table-heading">
        <h2
          id="sessions-table-heading"
          className="section-title"
          style={{ marginBlockEnd: "0.75rem" }}
        >
          Recent Drill Sessions
        </h2>
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="sessions-caption"
          className="table-wrapper scroller"
        >
          <table className="data-table">
            <caption id="sessions-caption">
              Logged Sessions ({overview.recentSessions.length})
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Mode &amp; Preset</th>
                <th scope="col">Score</th>
                <th scope="col">Throughput</th>
                <th scope="col">Mean / P90</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: "1.25rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    No sessions recorded yet.
                  </td>
                </tr>
              ) : (
                overview.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {new Date(s.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <strong>{s.preset.replace("_", " ")}</strong>
                      <div className="hint">{s.mode.replace("_", " ")}</div>
                    </td>
                    <td className="mono">
                      {s.correctCount}/{s.totalAttempts} ({s.wrongCount} err ·{" "}
                      {s.slowCorrectCount} slow)
                    </td>
                    <td className="mono">{s.ppm} Q/min</td>
                    <td className="mono">
                      {(s.meanMs / 1000).toFixed(2)}s /{" "}
                      {(s.p90Ms / 1000).toFixed(2)}s
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onInspectSession(s.id)}
                      >
                        Inspect Mistakes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
