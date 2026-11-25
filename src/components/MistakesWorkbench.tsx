"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  MessageSquare,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  analyzeProblemTrick,
  ERROR_CATEGORY_LABEL,
  formatProblemDisplay,
  generateSimilarProblem,
  OP_LABEL,
  type AttemptRecord,
  type MathProblem,
  type Operation,
} from "@/lib/math";
import { api } from "@/lib/client/api";

interface MistakesWorkbenchProps {
  sessionFilter: string;
  onClearSessionFilter: () => void;
  onAskCoachAboutAttempt: (attemptId: string, promptText?: string) => void;
  onAttemptUpdated: () => void;
}

type SortKey = "createdAt" | "reactionMs" | "op" | "errorCategory";

export function MistakesWorkbench({
  sessionFilter,
  onClearSessionFilter,
  onAskCoachAboutAttempt,
  onAttemptUpdated,
}: MistakesWorkbenchProps) {
  const [issueFilter, setIssueFilter] = useState<
    "issues" | "wrong" | "skipped_timeout" | "slow" | "all"
  >("issues");
  const [opFilter, setOpFilter] = useState<Operation | "all">("all");
  const [modeFilter, setModeFilter] = useState<"all" | "visual" | "voice">("all");

  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"ascending" | "descending">("descending");
  const [sortAnnouncement, setSortAnnouncement] = useState("");

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState(false);
  const [practiceProb, setPracticeProb] = useState<MathProblem | null>(null);
  const [practiceInput, setPracticeInput] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState<string | null>(null);
  const practiceStartRef = useRef<number>(0);

  const loadAttempts = useCallback(async () => {
    setLoadingAttempts(true);
    try {
      const res = await api.getAttempts({
        issueFilter,
        op: opFilter,
        mode: modeFilter,
        sessionId: sessionFilter || undefined,
        limit: 200,
      });
      setAttempts(res.attempts);
      setSelectedId((prev) => {
        if (prev && res.attempts.some((a) => a.id === prev)) return prev;
        return res.attempts[0]?.id ?? null;
      });
    } finally {
      setLoadingAttempts(false);
    }
  }, [issueFilter, modeFilter, opFilter, sessionFilter]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getAttempts({
          issueFilter,
          op: opFilter,
          mode: modeFilter,
          sessionId: sessionFilter || undefined,
          limit: 200,
        });
        if (!active) return;
        setAttempts(res.attempts);
        setSelectedId((prev) => {
          if (prev && res.attempts.some((a) => a.id === prev)) return prev;
          return res.attempts[0]?.id ?? null;
        });
      } catch {
        // ignore mount race
      }
    })();
    return () => {
      active = false;
    };
  }, [issueFilter, modeFilter, opFilter, sessionFilter]);

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.id === selectedId) ?? null,
    [attempts, selectedId],
  );

  const noteDraft = selectedAttempt
    ? (noteDrafts[selectedAttempt.id] ?? selectedAttempt.note ?? "")
    : "";

  const sortedAttempts = useMemo(() => {
    const factor = sortDir === "ascending" ? 1 : -1;
    return [...attempts].sort((a, b) => {
      if (sortKey === "reactionMs") return factor * (a.reactionMs - b.reactionMs);
      if (sortKey === "op") return factor * a.op.localeCompare(b.op);
      if (sortKey === "errorCategory") {
        return factor * a.errorCategory.localeCompare(b.errorCategory);
      }
      return factor * a.createdAt.localeCompare(b.createdAt);
    });
  }, [attempts, sortDir, sortKey]);

  const handleSort = (col: SortKey, label: string) => {
    const nextDir =
      sortKey === col
        ? sortDir === "ascending"
          ? "descending"
          : "ascending"
        : "descending";
    setSortKey(col);
    setSortDir(nextDir);
    setSortAnnouncement(`Sorted by ${label}, ${nextDir}, ${attempts.length} rows`);
  };

  const selectedTrick = useMemo(() => {
    if (!selectedAttempt) return null;
    return analyzeProblemTrick(
      selectedAttempt.op,
      selectedAttempt.a,
      selectedAttempt.b,
      selectedAttempt.correctAnswer,
    );
  }, [selectedAttempt]);

  const toggleReviewed = async (att: AttemptRecord) => {
    const res = await api.updateAttempt(att.id, { reviewed: !att.reviewed });
    setAttempts((prev) => prev.map((x) => (x.id === att.id ? res.attempt : x)));
    onAttemptUpdated();
  };

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttempt) return;
    setSavingNote(true);
    try {
      const res = await api.updateAttempt(selectedAttempt.id, {
        note: noteDraft.trim() || null,
        reviewed: true,
      });
      setAttempts((prev) =>
        prev.map((x) => (x.id === selectedAttempt.id ? res.attempt : x)),
      );
      onAttemptUpdated();
    } finally {
      setSavingNote(false);
    }
  };

  const startSimilarPractice = () => {
    if (!selectedAttempt) return;
    const sim = generateSimilarProblem(
      selectedAttempt.op,
      selectedAttempt.a,
      selectedAttempt.b,
    );
    setPracticeProb(sim);
    setPracticeInput("");
    setPracticeFeedback(null);
    practiceStartRef.current = performance.now();
  };

  const submitSimilarPractice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!practiceProb) return;
    const val = Number.parseInt(practiceInput.trim(), 10);
    if (Number.isNaN(val)) return;
    const ms = Math.round(performance.now() - practiceStartRef.current);
    if (val === practiceProb.answer) {
      setPracticeFeedback(
        `Exact! ${practiceProb.displayText} = ${practiceProb.answer} in ${(ms / 1000).toFixed(2)}s`,
      );
    } else {
      setPracticeFeedback(
        `Missed (${val}). Answer is ${practiceProb.answer} (${(ms / 1000).toFixed(2)}s).`,
      );
    }
  };

  return (
    <div className="workbench-grid">
      {/* Primary Mistake Log Table */}
      <section className="panel" aria-labelledby="mistakes-heading">
        <div className="section-header">
          <div>
            <h2 id="mistakes-heading" className="section-title">
              Mistake &amp; Slow-Solve Review
            </h2>
            <p className="section-sub">
              Inspect any flagged attempt for left-to-right mental decomposition,
              reflection notes, or sibling practice.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadAttempts()}
            disabled={loadingAttempts}
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.65rem",
            marginBlockEnd: "0.95rem",
            alignItems: "end",
          }}
        >
          <div className="field" style={{ flex: "1 1 170px" }}>
            <label htmlFor="filter-issue">Issue Type</label>
            <select
              id="filter-issue"
              className="select"
              value={issueFilter}
              onChange={(e) =>
                setIssueFilter(e.target.value as typeof issueFilter)
              }
            >
              <option value="issues">All Mistakes &amp; Slow Solves</option>
              <option value="wrong">Wrong Answers Only</option>
              <option value="skipped_timeout">Skipped &amp; Timed Out</option>
              <option value="slow">Slow Correct (&gt; pace)</option>
              <option value="all">All Logged Attempts</option>
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 145px" }}>
            <label htmlFor="filter-op">Operation</label>
            <select
              id="filter-op"
              className="select"
              value={opFilter}
              onChange={(e) => setOpFilter(e.target.value as Operation | "all")}
            >
              <option value="all">All Ops (+ − × ÷)</option>
              <option value="add">Addition (+)</option>
              <option value="sub">Subtraction (−)</option>
              <option value="mul">Multiplication (×)</option>
              <option value="div">Division (÷)</option>
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 145px" }}>
            <label htmlFor="filter-mode">Mode</label>
            <select
              id="filter-mode"
              className="select"
              value={modeFilter}
              onChange={(e) =>
                setModeFilter(e.target.value as "all" | "visual" | "voice")
              }
            >
              <option value="all">Visual &amp; Voice</option>
              <option value="visual">Visual Only</option>
              <option value="voice">Voice Modes</option>
            </select>
          </div>

          {sessionFilter && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClearSessionFilter}
            >
              Clear Session Filter
            </button>
          )}
        </div>

        <div role="status" className="visually-hidden">
          {sortAnnouncement}
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="mistakes-table-caption"
          className="table-wrapper responsive-mistakes-table scroller"
        >
          <table
            className="data-table"
            style={
              {
                "--label-1": '"Problem"',
                "--label-2": '"Yours"',
                "--label-3": '"Correct"',
                "--label-4": '"Speed"',
                "--label-5": '"Diagnosis"',
                "--label-6": '"Reviewed"',
              } as React.CSSProperties
            }
          >
            <caption id="mistakes-table-caption">
              Attempt History ({sortedAttempts.length} shown)
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  aria-sort={sortKey === "op" ? sortDir : undefined}
                >
                  <button
                    type="button"
                    className="sort-btn"
                    onClick={() => handleSort("op", "Problem")}
                  >
                    Problem
                    {sortKey === "op" &&
                      (sortDir === "ascending" ? (
                        <ArrowUp size={14} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={14} aria-hidden="true" />
                      ))}
                  </button>
                </th>
                <th scope="col">Yours</th>
                <th scope="col">Correct</th>
                <th
                  scope="col"
                  aria-sort={sortKey === "reactionMs" ? sortDir : undefined}
                >
                  <button
                    type="button"
                    className="sort-btn"
                    onClick={() => handleSort("reactionMs", "Speed")}
                  >
                    Speed
                    {sortKey === "reactionMs" &&
                      (sortDir === "ascending" ? (
                        <ArrowUp size={14} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={14} aria-hidden="true" />
                      ))}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortKey === "errorCategory" ? sortDir : undefined}
                >
                  <button
                    type="button"
                    className="sort-btn"
                    onClick={() => handleSort("errorCategory", "Diagnosis")}
                  >
                    Diagnosis
                    {sortKey === "errorCategory" &&
                      (sortDir === "ascending" ? (
                        <ArrowUp size={14} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={14} aria-hidden="true" />
                      ))}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortKey === "createdAt" ? sortDir : undefined}
                >
                  <button
                    type="button"
                    className="sort-btn"
                    onClick={() => handleSort("createdAt", "Logged Time")}
                  >
                    Reviewed
                    {sortKey === "createdAt" &&
                      (sortDir === "ascending" ? (
                        <ArrowUp size={14} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={14} aria-hidden="true" />
                      ))}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAttempts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: "1.5rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    No attempts match this filter yet. Run a drill to log
                    problems.
                  </td>
                </tr>
              ) : (
                sortedAttempts.map((att) => {
                  const isSelected = att.id === selectedId;
                  const pillClass =
                    att.status === "correct"
                      ? att.isSlow
                        ? "is-warn"
                        : "is-ok"
                      : "is-err";
                  return (
                    <tr
                      key={att.id}
                      className={isSelected ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedId(att.id);
                        setPracticeProb(null);
                        setPracticeInput("");
                        setPracticeFeedback(null);
                      }}
                    >
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {formatProblemDisplay(att.op, att.a, att.b)}
                      </td>
                      <td className="mono">
                        {att.status === "wrong"
                          ? (att.userAnswer ?? "—")
                          : att.status === "correct"
                            ? att.userAnswer
                            : att.status}
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {att.correctAnswer}
                      </td>
                      <td className="mono">
                        {(att.reactionMs / 1000).toFixed(2)}s
                        {att.processingMs !== null && (
                          <span
                            className="hint"
                            style={{ display: "block", fontSize: "0.73rem" }}
                          >
                            ({(att.processingMs / 1000).toFixed(2)}s proc)
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${pillClass}`}>
                          {att.status === "correct" && !att.isSlow ? (
                            <CheckCircle2 size={12} aria-hidden="true" />
                          ) : att.isSlow ? (
                            <Clock size={12} aria-hidden="true" />
                          ) : (
                            <XCircle size={12} aria-hidden="true" />
                          )}
                          {ERROR_CATEGORY_LABEL[att.errorCategory]}
                        </span>
                      </td>
                      <td>
                        {att.reviewed ? (
                          <span className="status-pill is-ok">
                            <Check size={12} aria-hidden="true" /> Reviewed
                          </span>
                        ) : (
                          <span className="status-pill is-neutral">Pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sticky Right Trick & Sibling Practice Inspector */}
      <aside className="panel workbench-sidebar" aria-labelledby="inspector-heading">
        {!selectedAttempt || !selectedTrick ? (
          <div className="stack-lg" style={{ gap: "0.5rem" }}>
            <h3 id="inspector-heading" className="section-title">
              Mental Trick Inspector
            </h3>
            <p className="hint">
              Select a mistake or slow solve from the table to inspect its
              fastest left-to-right decomposition and practice a sibling problem.
            </p>
          </div>
        ) : (
          <div className="stack-lg" style={{ gap: "0.9rem" }}>
            <div>
              <h3 id="inspector-heading" className="section-title mono">
                {formatProblemDisplay(
                  selectedAttempt.op,
                  selectedAttempt.a,
                  selectedAttempt.b,
                )}{" "}
                = {selectedAttempt.correctAnswer}
              </h3>
              <p className="section-sub">
                {OP_LABEL[selectedAttempt.op]} ·{" "}
                {selectedAttempt.mode.replace("_", " ")} ·{" "}
                {(selectedAttempt.reactionMs / 1000).toFixed(2)}s ·{" "}
                <code className="inline-code">{selectedAttempt.patternTag}</code>
              </p>
            </div>

            <div className="badge-row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void toggleReviewed(selectedAttempt)}
              >
                <Check size={14} aria-hidden="true" />
                {selectedAttempt.reviewed ? "Reviewed" : "Mark Reviewed"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={startSimilarPractice}
              >
                <Play size={14} aria-hidden="true" /> Practice Similar
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() =>
                  onAskCoachAboutAttempt(
                    selectedAttempt.id,
                    `Analyze my attempt on ${formatProblemDisplay(selectedAttempt.op, selectedAttempt.a, selectedAttempt.b)} and teach me the fastest shortcut.`,
                  )
                }
              >
                <MessageSquare size={14} aria-hidden="true" /> Ask Coach
              </button>
            </div>

            <div className="panel-subtle stack-lg" style={{ gap: "0.45rem" }}>
              <strong style={{ fontSize: "0.9rem" }}>
                Strategy: {selectedTrick.strategyName}
              </strong>
              <ol
                style={{
                  margin: 0,
                  paddingInlineStart: "1.2rem",
                  display: "grid",
                  gap: "0.28rem",
                  fontSize: "0.875rem",
                }}
              >
                {selectedTrick.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="hint" style={{ color: "var(--text-secondary)" }}>
                <strong>Habit Cue:</strong> {selectedTrick.shortcutTip}
              </p>
            </div>

            {practiceProb && (
              <div
                className="panel-subtle"
                style={{ borderColor: "var(--accent)" }}
              >
                <form
                  onSubmit={submitSimilarPractice}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.55rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: "1.1rem", fontWeight: 700 }}
                  >
                    {practiceProb.displayText} =
                  </span>
                  <label htmlFor="similar-input" className="visually-hidden">
                    Practice similar integer answer
                  </label>
                  <input
                    id="similar-input"
                    className="input mono"
                    style={{ maxInlineSize: "120px" }}
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={practiceInput}
                    onChange={(e) =>
                      setPracticeInput(e.target.value.replace(/(?!^-)[^0-9]/g, ""))
                    }
                    placeholder="Answer"
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Check
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={startSimilarPractice}
                  >
                    Next
                  </button>
                </form>
                {practiceFeedback && (
                  <p
                    style={{
                      marginBlockStart: "0.45rem",
                      fontSize: "0.84rem",
                      fontWeight: 600,
                    }}
                  >
                    {practiceFeedback}
                  </p>
                )}
              </div>
            )}

            <form onSubmit={saveNote} className="stack-lg" style={{ gap: "0.5rem" }}>
              <div className="field">
                <label htmlFor="mistake-note">Trader Reflection Note</label>
                <input
                  id="mistake-note"
                  className="input"
                  type="text"
                  value={noteDraft}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNoteDrafts((prev) => ({
                      ...prev,
                      [selectedAttempt.id]: val,
                    }));
                  }}
                  placeholder="e.g. Hold 1120 clearly before computing 56×3"
                />
              </div>
              <button
                type="submit"
                className="btn btn-sm"
                disabled={savingNote}
                style={{ justifySelf: "start" }}
              >
                {savingNote ? "Saving…" : "Save Note"}
              </button>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}
