"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Play, Send, Sparkles, Trash2, XCircle } from "lucide-react";
import type {
  CoachMessageRecord,
  PublicSettings,
  RecommendedDrill,
  WeaknessProfile,
} from "@/lib/math";
import { api } from "@/lib/client/api";
import { RichText } from "./RichText";

interface CoachWorkbenchProps {
  weakness: WeaknessProfile | null;
  settings: PublicSettings;
  pendingCoachRequest: {
    attemptId: string | null;
    question: string;
  } | null;
  onConsumePendingRequest: () => void;
  onLaunchRecommendedDrill: (drill: RecommendedDrill) => void;
}

export function CoachWorkbench({
  weakness,
  settings,
  pendingCoachRequest,
  onConsumePendingRequest,
  onLaunchRecommendedDrill,
}: CoachWorkbenchProps) {
  const [messages, setMessages] = useState<CoachMessageRecord[]>([]);
  const [question, setQuestion] = useState("");
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getCoachMessages();
        if (active) setMessages(res.messages);
      } catch {
        // ignore initial load error
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const submitCoachQuestion = useCallback(
    async (text: string, focusAttemptId: string | null = null) => {
      const clean = text.trim();
      if (!clean || askingCoach) return;
      setAskingCoach(true);
      setCoachError(null);
      try {
        const res = await api.askCoach({
          question: clean,
          focusAttemptId,
        });
        setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
        setQuestion("");
        requestAnimationFrame(() => {
          threadEndRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
      } catch (err) {
        setCoachError(
          err instanceof Error ? err.message : "Coach request failed",
        );
      } finally {
        setAskingCoach(false);
      }
    },
    [askingCoach],
  );

  useEffect(() => {
    if (!pendingCoachRequest) return;
    let active = true;
    (async () => {
      setAskingCoach(true);
      setCoachError(null);
      try {
        const res = await api.askCoach({
          question: pendingCoachRequest.question,
          focusAttemptId: pendingCoachRequest.attemptId,
        });
        if (!active) return;
        setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
        onConsumePendingRequest();
      } catch (err) {
        if (active) {
          setCoachError(
            err instanceof Error ? err.message : "Coach request failed",
          );
        }
      } finally {
        if (active) setAskingCoach(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onConsumePendingRequest, pendingCoachRequest]);

  return (
    <div className="workbench-grid">
      {/* Left: Coach Thread & Prompt Composer */}
      <section className="panel" aria-labelledby="coach-heading">
        <div className="section-header" style={{ marginBlockEnd: "0.65rem" }}>
          <div>
            <h2 id="coach-heading" className="section-title">
              Quant Mental Math Coach
            </h2>
            <p className="section-sub">
              {settings.aiProvider === "gemini" && settings.hasApiKey
                ? `Powered by Google Gemini (${settings.geminiPrimaryModel} / ${settings.geminiLiteModel})`
                : "Deterministic Quant Strategy Engine (enable Google Gemini in Settings anytime)"}
            </p>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              className="icon-button"
              onClick={async () => {
                await api.clearCoachMessages();
                setMessages([]);
              }}
              aria-label="Clear coach conversation"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="chip-scroller scroller" aria-label="Quick diagnostic prompts">
          {[
            "Analyze my biggest speed bottleneck",
            "How do I calculate 56*23 faster?",
            "Build a 6-minute drill plan",
            "Tips for Voice mode latency",
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
            <p className="hint" style={{ paddingBlock: "1rem" }}>
              Ask about any missed problem (e.g. &ldquo;How do I solve 154+353
              or 1288/23 faster?&rdquo;), or tap a diagnostic prompt chip above.
            </p>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`coach-bubble ${
                  msg.role === "user" ? "is-user" : "is-assistant"
                }`}
              >
                <div className="coach-meta">
                  <span>
                    {msg.role === "user"
                      ? "You"
                      : `Quant Coach (${msg.modelUsed ?? msg.provider})`}
                  </span>
                  <span>
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <RichText text={msg.content} />
                {msg.recommendedDrill && (
                  <div style={{ marginBlockStart: "0.6rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        onLaunchRecommendedDrill(msg.recommendedDrill!)
                      }
                    >
                      <Play size={13} aria-hidden="true" />{" "}
                      {msg.recommendedDrill.label}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={threadEndRef} />
        </div>

        {coachError && (
          <div
            className="feedback-banner feedback-err"
            style={{ marginBlockEnd: "0.6rem" }}
          >
            <XCircle size={15} aria-hidden="true" />
            <span>{coachError}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCoachQuestion(question);
          }}
          className="stack-lg"
          style={{ gap: "0.5rem" }}
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                void submitCoachQuestion(question);
              }
            }}
            placeholder="Ask about a mistake, 2×2 trick, or speed routine…"
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span className="hint">Enter to send · Shift+Enter for newline</span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={askingCoach || !question.trim()}
            >
              <Send size={14} aria-hidden="true" />{" "}
              {askingCoach ? "Thinking…" : "Ask Suggestion"}
            </button>
          </div>
        </form>
      </section>

      {/* Sticky Right Weakness Profile Sidebar */}
      <aside className="panel workbench-sidebar" aria-labelledby="weakness-heading">
        <div className="stack-lg" style={{ gap: "0.8rem" }}>
          <div>
            <h3 id="weakness-heading" className="section-title">
              Adaptive Weakness Profile
            </h3>
            <p className="section-sub">
              Computed continuously from your reaction latencies and mistake
              taxonomy.
            </p>
          </div>

          {weakness ? (
            <>
              <div className="panel-subtle stack-lg" style={{ gap: "0.5rem" }}>
                <strong style={{ fontSize: "0.9375rem" }}>
                  {weakness.headline}
                </strong>
                <ul
                  style={{
                    margin: 0,
                    paddingInlineStart: "1.15rem",
                    fontSize: "0.84rem",
                    color: "var(--text-secondary)",
                    display: "grid",
                    gap: "0.3rem",
                  }}
                >
                  {weakness.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  onLaunchRecommendedDrill({
                    label: "Weakness Targeted Drill",
                    preset: "weakness_drill",
                    operations: weakness.priorityOps.length
                      ? weakness.priorityOps
                      : ["add", "sub", "mul", "div"],
                    operationWeights: weakness.weights,
                    targetMs: weakness.recommendedConfig.targetMs,
                  })
                }
              >
                <Sparkles size={15} aria-hidden="true" /> Launch Weakness Drill
              </button>
            </>
          ) : (
            <p className="hint">Loading telemetry profile…</p>
          )}
        </div>
      </aside>
    </div>
  );
}
