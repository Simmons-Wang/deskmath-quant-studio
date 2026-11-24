import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  analyzeProblemTrick,
  ERROR_CATEGORY_LABEL,
  formatProblemDisplay,
  generateSimilarProblem,
  OP_LABEL,
  type MathProblem,
  type Operation,
} from '../../../shared/math.js';
import {
  api,
  type AttemptRecord,
  type CoachMessageRecord,
  type RecommendedDrill,
  type WeaknessProfile,
} from '../api/client.js';
import { RichText } from './RichText.js';

interface MistakesCoachViewProps {
  weakness: WeaknessProfile | null;
  initialSessionFilter?: string;
  initialCoachAttemptId?: string | null;
  onClearInitialCoachAttempt: () => void;
  onLaunchRecommendedDrill: (drill: RecommendedDrill) => void;
  onAttemptUpdated: () => void;
}

type SortKey = 'createdAt' | 'reactionMs' | 'op' | 'errorCategory';

export function MistakesCoachView({
  weakness,
  initialSessionFilter,
  initialCoachAttemptId,
  onClearInitialCoachAttempt,
  onLaunchRecommendedDrill,
  onAttemptUpdated,
}: MistakesCoachViewProps) {
  const [issueFilter, setIssueFilter] = useState<'issues' | 'wrong' | 'skipped_timeout' | 'slow' | 'all'>('issues');
  const [opFilter, setOpFilter] = useState<Operation | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'visual' | 'voice'>('all');
  const [sessionFilter, setSessionFilter] = useState<string>(initialSessionFilter ?? '');

  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('descending');
  const [sortAnnouncement, setSortAnnouncement] = useState('');

  // Note editing & inline practice
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState(false);
  const [practiceProb, setPracticeProb] = useState<MathProblem | null>(null);
  const [practiceInput, setPracticeInput] = useState('');
  const [practiceFeedback, setPracticeFeedback] = useState<string | null>(null);
  const practiceStartRef = useRef<number>(0);

  // Coach chat state
  const [messages, setMessages] = useState<CoachMessageRecord[]>([]);
  const [question, setQuestion] = useState('');
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [focusAttemptId, setFocusAttemptId] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

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
        // ignore transient error on initial mount
      }
    })();
    return () => {
      active = false;
    };
  }, [issueFilter, modeFilter, opFilter, sessionFilter]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getCoachMessages();
        if (active) setMessages(res.messages);
      } catch {
        // ignore initial load hiccup
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.id === selectedId) ?? null,
    [attempts, selectedId],
  );

  const noteDraft = selectedAttempt
    ? (noteDrafts[selectedAttempt.id] ?? selectedAttempt.note ?? '')
    : '';

  const sortedAttempts = useMemo(() => {
    const factor = sortDir === 'ascending' ? 1 : -1;
    return [...attempts].sort((a, b) => {
      if (sortKey === 'reactionMs') return factor * (a.reactionMs - b.reactionMs);
      if (sortKey === 'op') return factor * a.op.localeCompare(b.op);
      if (sortKey === 'errorCategory') {
        return factor * a.errorCategory.localeCompare(b.errorCategory);
      }
      return factor * a.createdAt.localeCompare(b.createdAt);
    });
  }, [attempts, sortDir, sortKey]);

  const handleSort = (col: SortKey, label: string) => {
    const nextDir =
      sortKey === col ? (sortDir === 'ascending' ? 'descending' : 'ascending') : 'descending';
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

  const submitCoachQuestion = useCallback(
    async (text: string, attemptIdOverride?: string | null) => {
      const clean = text.trim();
      if (!clean || askingCoach) return;
      setAskingCoach(true);
      setCoachError(null);
      try {
        const res = await api.askCoach({
          question: clean,
          focusAttemptId: attemptIdOverride !== undefined ? attemptIdOverride : focusAttemptId,
        });
        setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
        setQuestion('');
        setFocusAttemptId(null);
        requestAnimationFrame(() => {
          threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      } catch (err) {
        setCoachError(err instanceof Error ? err.message : 'Coach request failed');
      } finally {
        setAskingCoach(false);
      }
    },
    [askingCoach, focusAttemptId],
  );

  // Triggered when user clicked "Ask Coach" from Session Debrief
  useEffect(() => {
    if (!initialCoachAttemptId) return;
    let active = true;
    (async () => {
      try {
        const res = await api.askCoach({
          question:
            'Analyze this mistake, explain why it happened, and give me the fastest mental trick for it.',
          focusAttemptId: initialCoachAttemptId,
        });
        if (!active) return;
        setSelectedId(initialCoachAttemptId);
        setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
        onClearInitialCoachAttempt();
      } catch (err) {
        if (active) {
          setCoachError(err instanceof Error ? err.message : 'Coach request failed');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [initialCoachAttemptId, onClearInitialCoachAttempt]);

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
      setAttempts((prev) => prev.map((x) => (x.id === selectedAttempt.id ? res.attempt : x)));
      onAttemptUpdated();
    } finally {
      setSavingNote(false);
    }
  };

  const startSimilarPractice = () => {
    if (!selectedAttempt) return;
    const sim = generateSimilarProblem(selectedAttempt.op, selectedAttempt.a, selectedAttempt.b);
    setPracticeProb(sim);
    setPracticeInput('');
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
      setPracticeFeedback(`Exact! ${practiceProb.displayText} = ${practiceProb.answer} in ${(ms / 1000).toFixed(2)}s`);
    } else {
      setPracticeFeedback(`Missed (${val}). Answer is ${practiceProb.answer} (${(ms / 1000).toFixed(2)}s).`);
    }
  };

  return (
    <div className="coach-workspace">
      {/* Left column: Mistakes table + Inspector */}
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <section className="panel" aria-labelledby="mistakes-heading">
          <div className="section-header">
            <div>
              <h2 id="mistakes-heading" className="section-title">
                Mistake &amp; Slow-Solve Review
              </h2>
              <p className="section-sub">
                Select any flagged attempt to inspect its mental math decomposition, log notes, or practice a sibling problem.
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

          {/* Filter bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBlockEnd: '1rem', alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="filter-issue">Issue Type</label>
              <select
                id="filter-issue"
                className="select"
                style={{ minBlockSize: '38px', fontSize: '0.875rem' }}
                value={issueFilter}
                onChange={(e) => setIssueFilter(e.target.value as typeof issueFilter)}
              >
                <option value="issues">All Mistakes &amp; Slow Solves</option>
                <option value="wrong">Wrong Answers Only</option>
                <option value="skipped_timeout">Skipped &amp; Timed Out</option>
                <option value="slow">Slow Correct (&gt; target ms)</option>
                <option value="all">All Logged Attempts</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="filter-op">Operation</label>
              <select
                id="filter-op"
                className="select"
                style={{ minBlockSize: '38px', fontSize: '0.875rem' }}
                value={opFilter}
                onChange={(e) => setOpFilter(e.target.value as Operation | 'all')}
              >
                <option value="all">All Ops (+ − × ÷)</option>
                <option value="add">Addition (+)</option>
                <option value="sub">Subtraction (−)</option>
                <option value="mul">Multiplication (×)</option>
                <option value="div">Division (÷)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="filter-mode">Mode</label>
              <select
                id="filter-mode"
                className="select"
                style={{ minBlockSize: '38px', fontSize: '0.875rem' }}
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as 'all' | 'visual' | 'voice')}
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
                onClick={() => setSessionFilter('')}
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
                  '--label-1': '"Problem"',
                  '--label-2': '"Yours"',
                  '--label-3': '"Correct"',
                  '--label-4': '"Speed"',
                  '--label-5': '"Diagnosis"',
                  '--label-6': '"Status"',
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
                    aria-sort={sortKey === 'op' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      className="sort-btn"
                      onClick={() => handleSort('op', 'Problem')}
                    >
                      Problem
                      {sortKey === 'op' &&
                        (sortDir === 'ascending' ? (
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
                    aria-sort={sortKey === 'reactionMs' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      className="sort-btn"
                      onClick={() => handleSort('reactionMs', 'Speed')}
                    >
                      Speed
                      {sortKey === 'reactionMs' &&
                        (sortDir === 'ascending' ? (
                          <ArrowUp size={14} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={14} aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortKey === 'errorCategory' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      className="sort-btn"
                      onClick={() => handleSort('errorCategory', 'Diagnosis')}
                    >
                      Diagnosis
                      {sortKey === 'errorCategory' &&
                        (sortDir === 'ascending' ? (
                          <ArrowUp size={14} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={14} aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortKey === 'createdAt' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      className="sort-btn"
                      onClick={() => handleSort('createdAt', 'Logged Time')}
                    >
                      Reviewed
                      {sortKey === 'createdAt' &&
                        (sortDir === 'ascending' ? (
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
                    <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                      No attempts match this filter yet. Run a drill to log problems.
                    </td>
                  </tr>
                ) : (
                  sortedAttempts.map((att) => {
                    const isSelected = att.id === selectedId;
                    const pillClass =
                      att.status === 'correct'
                        ? att.isSlow
                          ? 'is-warn'
                          : 'is-ok'
                        : 'is-err';
                    return (
                      <tr
                        key={att.id}
                        className={isSelected ? 'is-selected' : ''}
                        onClick={() => {
                          setSelectedId(att.id);
                          setPracticeProb(null);
                          setPracticeInput('');
                          setPracticeFeedback(null);
                        }}
                      >
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {formatProblemDisplay(att.op, att.a, att.b)}
                        </td>
                        <td className="mono">
                          {att.status === 'wrong'
                            ? att.userAnswer ?? '—'
                            : att.status === 'correct'
                              ? att.userAnswer
                              : att.status}
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {att.correctAnswer}
                        </td>
                        <td className="mono">
                          {(att.reactionMs / 1000).toFixed(2)}s
                          {att.processingMs !== null && (
                            <span className="hint" style={{ display: 'block', fontSize: '0.75rem' }}>
                              ({(att.processingMs / 1000).toFixed(2)}s proc)
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill ${pillClass}`}>
                            {att.status === 'correct' && !att.isSlow ? (
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

        {/* Selected Mistake Trick Inspector */}
        {selectedAttempt && selectedTrick && (
          <section className="panel" aria-labelledby="inspector-heading">
            <div className="section-header">
              <div>
                <h3 id="inspector-heading" className="section-title mono">
                  {formatProblemDisplay(selectedAttempt.op, selectedAttempt.a, selectedAttempt.b)} ={' '}
                  {selectedAttempt.correctAnswer}
                </h3>
                <p className="section-sub">
                  {OP_LABEL[selectedAttempt.op]} · {selectedAttempt.mode.replace('_', ' ')} ·{' '}
                  {(selectedAttempt.reactionMs / 1000).toFixed(2)}s · Pattern:{' '}
                  <code className="inline-code">{selectedAttempt.patternTag}</code>
                </p>
              </div>
              <div className="chip-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void toggleReviewed(selectedAttempt)}
                >
                  <Check size={14} aria-hidden="true" />
                  {selectedAttempt.reviewed ? 'Reviewed' : 'Mark Reviewed'}
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
                  onClick={() => {
                    setFocusAttemptId(selectedAttempt.id);
                    void submitCoachQuestion(
                      `Analyze my attempt on ${formatProblemDisplay(selectedAttempt.op, selectedAttempt.a, selectedAttempt.b)} and teach me the fastest shortcut.`,
                      selectedAttempt.id,
                    );
                  }}
                >
                  <MessageSquare size={14} aria-hidden="true" /> Ask Coach
                </button>
              </div>
            </div>

            <div className="panel-subtle" style={{ display: 'grid', gap: '0.5rem' }}>
              <strong style={{ fontSize: '0.9375rem' }}>
                Recommended Strategy: {selectedTrick.strategyName}
              </strong>
              <ol style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: '0.3rem', fontSize: '0.9375rem' }}>
                {selectedTrick.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="hint" style={{ color: 'var(--text-secondary)' }}>
                <strong>Habit Cue:</strong> {selectedTrick.shortcutTip}
              </p>
            </div>

            {practiceProb && (
              <div className="panel-subtle" style={{ marginBlockStart: '0.85rem', borderColor: 'var(--accent)' }}>
                <form
                  onSubmit={submitSimilarPractice}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
                >
                  <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                    {practiceProb.displayText} =
                  </span>
                  <label htmlFor="similar-input" className="visually-hidden">
                    Practice similar integer answer
                  </label>
                  <input
                    id="similar-input"
                    className="input mono"
                    style={{ maxInlineSize: '140px' }}
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={practiceInput}
                    onChange={(e) => setPracticeInput(e.target.value.replace(/(?!^-)[^0-9]/g, ''))}
                    placeholder="Answer"
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Check
                  </button>
                  <button type="button" className="btn btn-sm" onClick={startSimilarPractice}>
                    New Sibling
                  </button>
                </form>
                {practiceFeedback && (
                  <p style={{ marginBlockStart: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                    {practiceFeedback}
                  </p>
                )}
              </div>
            )}

            <form onSubmit={saveNote} style={{ marginBlockStart: '0.9rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'end' }}>
              <div className="field" style={{ flex: 1, minInlineSize: '220px' }}>
                <label htmlFor="mistake-note">Trader Reflection Note</label>
                <input
                  id="mistake-note"
                  className="input"
                  type="text"
                  value={noteDraft}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNoteDrafts((prev) => ({ ...prev, [selectedAttempt.id]: val }));
                  }}
                  placeholder="e.g. Hold 1120 clearly before computing 56×3"
                />
              </div>
              <button type="submit" className="btn" disabled={savingNote}>
                {savingNote ? 'Saving…' : 'Save Note'}
              </button>
            </form>
          </section>
        )}
      </div>

      {/* Right column: Quant Coach ("Ask for Suggestion") */}
      <aside className="panel" aria-labelledby="coach-heading">
        <div className="section-header" style={{ marginBlockEnd: '0.65rem' }}>
          <div>
            <h2 id="coach-heading" className="section-title">
              Quant Math Coach
            </h2>
            <p className="section-sub">
              Grounded in your live telemetry, error patterns, and speed gaps.
            </p>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                await api.clearCoachMessages();
                setMessages([]);
              }}
              aria-label="Clear coach conversation"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {weakness && (
          <div className="panel-subtle" style={{ display: 'grid', gap: '0.5rem', marginBlockEnd: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.9375rem' }}>{weakness.headline}</strong>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  onLaunchRecommendedDrill({
                    label: 'Weakness Targeted Drill',
                    preset: 'weakness_drill',
                    operations: weakness.priorityOps.length ? weakness.priorityOps : ['add', 'sub', 'mul', 'div'],
                    operationWeights: weakness.weights,
                    targetMs: weakness.recommendedConfig.targetMs,
                  })
                }
              >
                <Sparkles size={14} aria-hidden="true" /> Launch Weakness Drill
              </button>
            </div>
            <ul style={{ margin: 0, paddingInlineStart: '1.15rem', fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'grid', gap: '0.25rem' }}>
              {weakness.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="chip-row" style={{ marginBlockEnd: '0.5rem' }}>
          {[
            'Analyze my biggest speed bottleneck',
            'How do I calculate 56*23 faster?',
            'Build a 6-minute drill plan',
            'Tips for Voice mode latency',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="btn btn-sm"
              disabled={askingCoach}
              onClick={() => void submitCoachQuestion(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="coach-thread scroller" aria-live="polite">
          {messages.length === 0 ? (
            <p className="hint" style={{ paddingBlock: '1rem' }}>
              Ask about any missed problem (e.g. &ldquo;How do I solve 154+353 or 1288/23 faster?&rdquo;), or click a quick diagnostic prompt above.
            </p>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`coach-bubble ${msg.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                <div className="coach-meta">
                  <span>{msg.role === 'user' ? 'You' : `Quant Coach (${msg.provider})`}</span>
                  <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <RichText text={msg.content} />
                {msg.recommendedDrill && (
                  <div style={{ marginBlockStart: '0.6rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onLaunchRecommendedDrill(msg.recommendedDrill!)}
                    >
                      <Play size={13} aria-hidden="true" /> {msg.recommendedDrill.label}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={threadEndRef} />
        </div>

        {coachError && (
          <div className="feedback-banner feedback-err" style={{ marginBlockEnd: '0.6rem' }}>
            <XCircle size={15} aria-hidden="true" />
            <span>{coachError}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCoachQuestion(question);
          }}
          style={{ display: 'grid', gap: '0.5rem' }}
        >
          <label htmlFor="coach-question-input" className="field-label">
            Ask Coach for Suggestion
          </label>
          <textarea
            id="coach-question-input"
            className="textarea"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                void submitCoachQuestion(question);
              }
            }}
            placeholder="Ask about a mistake, 2×2 trick, or speed routine…"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span className="hint">Enter to send · Shift+Enter for newline</span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={askingCoach || !question.trim()}
            >
              <Send size={14} aria-hidden="true" /> {askingCoach ? 'Thinking…' : 'Ask Suggestion'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
