"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Headphones,
  Keyboard,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  SkipForward,
  Sliders,
  Sparkles,
  Square,
  Volume2,
  XCircle,
} from "lucide-react";
import {
  analyzeProblemTrick,
  classifyAttemptError,
  DRILL_PRESETS,
  ERROR_CATEGORY_LABEL,
  formatProblemDisplay,
  generateProblem,
  OP_LABEL,
  OP_SYMBOL,
  parseSpokenTranscript,
  type AttemptRecord,
  type AttemptStatus,
  type DrillConfig,
  type MathProblem,
  type Operation,
  type PresetId,
  type PublicSettings,
  type SessionRecord,
  type SubmissionMode,
  type TrainingMode,
} from "@/lib/math";
import { api } from "@/lib/client/api";
import {
  getSpeechRecognitionCtor,
  hasSpeechSynthesis,
  playCue,
  speakMathPrompt,
  stopSpeaking,
  unlockAudioAndSpeechOnGesture,
  type SpeechRecognitionLike,
} from "@/lib/client/audioEngine";
import { CustomRangeModal } from "./CustomRangeModal";

interface LocalAttempt {
  seq: number;
  op: Operation;
  a: number;
  b: number;
  correctAnswer: number;
  userAnswer: number | null;
  rawInput: string;
  status: AttemptStatus;
  mode: TrainingMode;
  reactionMs: number;
  processingMs: number | null;
  isSlow: boolean;
  patternTag: string;
  trickSummary: string;
}

interface TrainArenaProps {
  config: DrillConfig;
  onChangeConfig: React.Dispatch<React.SetStateAction<DrillConfig>>;
  settings: PublicSettings;
  weaknessWeights: Record<Operation, number>;
  onSessionSaved: (session: SessionRecord, attempts: AttemptRecord[]) => void;
  onOpenMistakes: (sessionId?: string) => void;
  onAskCoachAboutAttempt: (attemptId: string) => void;
  announce: (message: string) => void;
}

type DrillPhase = "setup" | "running" | "summary";

export function TrainArena({
  config,
  onChangeConfig,
  settings,
  weaknessWeights,
  onSessionSaved,
  onOpenMistakes,
  onAskCoachAboutAttempt,
  announce,
}: TrainArenaProps) {
  const [phase, setPhase] = useState<DrillPhase>("setup");
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [perQuestionTimeoutSec, setPerQuestionTimeoutSec] = useState<number>(0);
  const [showKeypad, setShowKeypad] = useState(false);

  const [currentProblem, setCurrentProblem] = useState<MathProblem | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [attempts, setAttempts] = useState<LocalAttempt[]>([]);
  const [streak, setStreak] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [problemElapsedMs, setProblemElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "warn" | "err";
    text: string;
  } | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [peekVisual, setPeekVisual] = useState(false);

  const [savedSession, setSavedSession] = useState<SessionRecord | null>(null);
  const [savedAttempts, setSavedAttempts] = useState<AttemptRecord[]>([]);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const problemStartRef = useRef<number>(0);
  const speechEndRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(0);
  const isSpeakingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<DrillPhase>("setup");
  const currentProblemRef = useRef<MathProblem | null>(null);
  const attemptsRef = useRef<LocalAttempt[]>([]);
  const cancelSpeakRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
    currentProblemRef.current = currentProblem;
    attemptsRef.current = attempts;
  }, [attempts, currentProblem, phase]);

  const speechRecSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);
  const ttsSupported = useMemo(() => hasSpeechSynthesis(), []);

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      recognitionRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // ignore abort
      }
    }
    setIsListening(false);
  }, []);

  const finishSession = useCallback(
    async (finalAttempts: LocalAttempt[]) => {
      if (phaseRef.current !== "running") return;
      phaseRef.current = "summary";
      setPhase("summary");
      stopSpeaking();
      cancelSpeakRef.current?.();
      cancelSpeakRef.current = null;
      stopRecognition();

      const totalElapsed = Math.max(
        1000,
        Math.round(performance.now() - sessionStartRef.current),
      );
      setElapsedMs(totalElapsed);

      if (finalAttempts.length === 0) {
        setSavedSession(null);
        setSavedAttempts([]);
        setPhase("setup");
        phaseRef.current = "setup";
        announce("Session canceled.");
        return;
      }

      setIsSaving(true);
      setSavingError(null);
      try {
        const res = await api.saveSession({
          mode: config.mode,
          preset: config.preset,
          format: config.format,
          submissionMode: config.submissionMode,
          durationLimitSec: config.format === "timed" ? config.durationSec : null,
          questionLimit: config.format === "fixed" ? config.questionCount : null,
          targetMs: config.targetMs,
          operations: config.operations,
          allowNegative: config.ranges.sub.allowNegative,
          elapsedMs: totalElapsed,
          attempts: finalAttempts.map((a) => ({
            seq: a.seq,
            op: a.op,
            a: a.a,
            b: a.b,
            userAnswer: a.userAnswer,
            rawInput: a.rawInput,
            status: a.status,
            mode: a.mode,
            reactionMs: a.reactionMs,
            processingMs: a.processingMs,
          })),
        });
        setSavedSession(res.session);
        setSavedAttempts(res.attempts);
        onSessionSaved(res.session, res.attempts);
        announce(
          `Session finished: ${res.session.correctCount} of ${res.session.totalAttempts} correct, ${res.session.ppm} problems per minute.`,
        );
      } catch (err) {
        setSavingError(
          err instanceof Error ? err.message : "Could not save session",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [announce, config, onSessionSaved, stopRecognition],
  );

  const startHandsFreeMic = useCallback(
    (
      onParsedNumber: (val: number, rawTranscript: string) => void,
      onCmd: (cmd: "skip" | "repeat" | "stop") => void,
    ) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setMicError(
          "SpeechRecognition is unavailable in this browser; keyboard/keypad stays active.",
        );
        return;
      }
      stopRecognition();
      setMicError(null);

      try {
        const rec = new Ctor();
        rec.lang = "en-US";
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;

        rec.onresult = (ev) => {
          if (phaseRef.current !== "running" || isSpeakingRef.current) return;
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
            const res = ev.results[i];
            const transcript = res[0]?.transcript ?? "";
            if (res.isFinal) {
              setLiveTranscript(transcript);
              let handled = false;
              for (let altIdx = 0; altIdx < res.length; altIdx += 1) {
                const altText = res[altIdx]?.transcript ?? "";
                const parsed = parseSpokenTranscript(altText);
                if (parsed.kind === "number") {
                  onParsedNumber(parsed.value, altText);
                  handled = true;
                  break;
                }
                if (parsed.kind === "command") {
                  onCmd(parsed.command);
                  handled = true;
                  break;
                }
              }
              if (!handled) {
                setLiveTranscript(`Heard "${transcript.trim()}" — say integer or type`);
              }
            } else {
              interim += transcript;
            }
          }
          if (interim) setLiveTranscript(interim);
        };

        rec.onerror = (ev) => {
          if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
            setMicError("Microphone permission denied. Keyboard entry stays active.");
            setIsListening(false);
          } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
            setMicError(`Mic status: ${ev.error}. Keyboard entry stays active.`);
          }
        };

        rec.onend = () => {
          if (
            phaseRef.current === "running" &&
            config.mode === "voice_handsfree" &&
            !isSpeakingRef.current &&
            recognitionRef.current === rec
          ) {
            try {
              rec.start();
            } catch {
              setIsListening(false);
            }
          } else {
            setIsListening(false);
          }
        };

        recognitionRef.current = rec;
        rec.start();
        setIsListening(true);
      } catch {
        setMicError("Could not start microphone. Keyboard entry stays active.");
      }
    },
    [config.mode, stopRecognition],
  );

  const submitAttemptRef = useRef<
    (status: AttemptStatus, userAnswer: number | null, rawInput: string) => void
  >(() => {});
  const replayAudioRef = useRef<() => void>(() => {});

  const dispatchProblem = useCallback(
    (excludeKey?: string) => {
      const effectiveConfig: DrillConfig =
        config.preset === "weakness_drill"
          ? { ...config, operationWeights: weaknessWeights }
          : config;
      const next = generateProblem(effectiveConfig, excludeKey);
      setCurrentProblem(next);
      currentProblemRef.current = next;
      setInputVal("");
      setPeekVisual(false);
      setLiveTranscript("");
      setProblemElapsedMs(0);
      problemStartRef.current = performance.now();
      speechEndRef.current = null;

      if (config.mode !== "visual") {
        cancelSpeakRef.current?.();
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        if (recognitionRef.current) stopRecognition();

        cancelSpeakRef.current = speakMathPrompt({
          text: next.spokenText,
          rate: config.speechRate,
          voiceName: settings.voiceName,
          cloudTtsEnabled: settings.cloudTtsEnabled,
          onStart: () => {
            isSpeakingRef.current = true;
            setIsSpeaking(true);
          },
          onEnd: () => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            speechEndRef.current = performance.now();
            if (phaseRef.current === "running" && config.mode === "voice_handsfree") {
              startHandsFreeMic(
                (val, raw) =>
                  submitAttemptRef.current(
                    val === next.answer ? "correct" : "wrong",
                    val,
                    raw,
                  ),
                (cmd) => {
                  if (cmd === "skip") {
                    submitAttemptRef.current("skipped", null, "[voice skip]");
                  } else if (cmd === "repeat") {
                    replayAudioRef.current();
                  } else if (cmd === "stop") {
                    void finishSession(attemptsRef.current);
                  }
                },
              );
            }
          },
        });
      }

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    },
    [
      config,
      finishSession,
      settings.cloudTtsEnabled,
      settings.voiceName,
      startHandsFreeMic,
      stopRecognition,
      weaknessWeights,
    ],
  );

  const replayAudio = useCallback(() => {
    const prob = currentProblemRef.current;
    if (!prob || phaseRef.current !== "running") return;
    cancelSpeakRef.current?.();
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    if (recognitionRef.current) stopRecognition();

    cancelSpeakRef.current = speakMathPrompt({
      text: prob.spokenText,
      rate: config.speechRate,
      voiceName: settings.voiceName,
      cloudTtsEnabled: settings.cloudTtsEnabled,
      onEnd: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        if (speechEndRef.current === null) {
          speechEndRef.current = performance.now();
        }
        if (phaseRef.current === "running" && config.mode === "voice_handsfree") {
          startHandsFreeMic(
            (val, raw) =>
              submitAttemptRef.current(
                val === prob.answer ? "correct" : "wrong",
                val,
                raw,
              ),
            (cmd) => {
              if (cmd === "skip") {
                submitAttemptRef.current("skipped", null, "[voice skip]");
              } else if (cmd === "repeat") {
                replayAudioRef.current();
              } else if (cmd === "stop") {
                void finishSession(attemptsRef.current);
              }
            },
          );
        }
      },
    });
    inputRef.current?.focus();
  }, [
    config.mode,
    config.speechRate,
    finishSession,
    settings.cloudTtsEnabled,
    settings.voiceName,
    startHandsFreeMic,
    stopRecognition,
  ]);

  useEffect(() => {
    replayAudioRef.current = replayAudio;
  }, [replayAudio]);

  const submitAttempt = useCallback(
    (status: AttemptStatus, userAnswer: number | null, rawInput: string) => {
      const prob = currentProblemRef.current;
      if (!prob || phaseRef.current !== "running") return;

      const now = performance.now();
      const reactionMs = Math.max(60, Math.round(now - problemStartRef.current));
      const processingMs =
        config.mode !== "visual" && speechEndRef.current !== null
          ? Math.max(50, Math.round(now - speechEndRef.current))
          : null;

      const resolvedStatus: AttemptStatus =
        status === "skipped" || status === "timeout"
          ? status
          : userAnswer === prob.answer
            ? "correct"
            : "wrong";

      const isSlow = resolvedStatus === "correct" && reactionMs > config.targetMs;
      const trick = analyzeProblemTrick(prob.op, prob.a, prob.b, prob.answer);

      const entry: LocalAttempt = {
        seq: attemptsRef.current.length + 1,
        op: prob.op,
        a: prob.a,
        b: prob.b,
        correctAnswer: prob.answer,
        userAnswer,
        rawInput,
        status: resolvedStatus,
        mode: config.mode,
        reactionMs,
        processingMs,
        isSlow,
        patternTag: prob.patternTag,
        trickSummary: trick.summary,
      };

      const nextAttempts = [...attemptsRef.current, entry];
      attemptsRef.current = nextAttempts;
      setAttempts(nextAttempts);

      if (resolvedStatus === "correct") {
        playCue("hit", settings.soundEnabled);
        setStreak((s) => s + 1);
        setFeedback({
          kind: isSlow ? "warn" : "ok",
          text: isSlow
            ? `Correct (${(reactionMs / 1000).toFixed(2)}s — above ${(config.targetMs / 1000).toFixed(1)}s pace)`
            : `Exact ${(reactionMs / 1000).toFixed(2)}s`,
        });
      } else {
        playCue("miss", settings.soundEnabled);
        setStreak(0);
        setFeedback({
          kind: "err",
          text: `${prob.displayText} = ${prob.answer} (${resolvedStatus === "wrong" ? `typed ${userAnswer ?? "—"}` : resolvedStatus})`,
        });
      }

      if (config.format === "fixed" && nextAttempts.length >= config.questionCount) {
        void finishSession(nextAttempts);
        return;
      }

      dispatchProblem(`${prob.op}:${prob.a}:${prob.b}`);
    },
    [config, dispatchProblem, finishSession, settings.soundEnabled],
  );

  useEffect(() => {
    submitAttemptRef.current = submitAttempt;
  }, [submitAttempt]);

  const startSession = useCallback(() => {
    if (config.operations.length === 0) return;
    unlockAudioAndSpeechOnGesture();
    setAttempts([]);
    attemptsRef.current = [];
    setStreak(0);
    setFeedback(null);
    setSavedSession(null);
    setSavedAttempts([]);
    setSavingError(null);
    setMicError(null);
    setElapsedMs(0);
    setProblemElapsedMs(0);

    sessionStartRef.current = performance.now();
    phaseRef.current = "running";
    setPhase("running");
    announce("Drill started.");
    dispatchProblem();
  }, [announce, config.operations.length, dispatchProblem]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const total = Math.round(now - sessionStartRef.current);
      const probMs = Math.round(now - problemStartRef.current);
      setElapsedMs(total);
      setProblemElapsedMs(probMs);

      if (config.format === "timed" && total >= config.durationSec * 1000) {
        void finishSession(attemptsRef.current);
        return;
      }

      if (perQuestionTimeoutSec > 0 && probMs >= perQuestionTimeoutSec * 1000) {
        submitAttemptRef.current("timeout", null, "[timeout]");
      }
    }, 80);

    return () => window.clearInterval(id);
  }, [config.durationSec, config.format, finishSession, perQuestionTimeoutSec, phase]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      cancelSpeakRef.current?.();
      stopRecognition();
    };
  }, [stopRecognition]);

  const handleInputChange = (raw: string) => {
    const sanitized = raw.replace(/(?!^-)[^0-9]/g, "");
    setInputVal(sanitized);

    const prob = currentProblem;
    if (!prob || phase !== "running") return;
    if (sanitized === "" || sanitized === "-") return;

    const num = Number.parseInt(sanitized, 10);
    if (Number.isNaN(num)) return;

    if (config.submissionMode === "exact_auto") {
      if (num === prob.answer) {
        submitAttempt("correct", num, sanitized);
      }
    } else if (config.submissionMode === "length_auto") {
      const targetStr = String(prob.answer);
      if (sanitized.length >= targetStr.length) {
        submitAttempt(num === prob.answer ? "correct" : "wrong", num, sanitized);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProblem || phase !== "running") return;
    const trimmed = inputVal.trim();
    if (!trimmed || trimmed === "-") return;
    const num = Number.parseInt(trimmed, 10);
    if (Number.isNaN(num)) return;
    submitAttempt(num === currentProblem.answer ? "correct" : "wrong", num, trimmed);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === " " || e.key.toLowerCase() === "s") {
      e.preventDefault();
      submitAttempt("skipped", null, inputVal || "[skipped]");
    } else if (e.key.toLowerCase() === "r" && config.mode !== "visual") {
      e.preventDefault();
      replayAudio();
    } else if (e.key.toLowerCase() === "v" && config.mode !== "visual") {
      e.preventDefault();
      setPeekVisual((v) => !v);
    } else if (e.key === "Escape") {
      e.preventDefault();
      void finishSession(attemptsRef.current);
    }
  };

  const applyPreset = (presetId: Exclude<PresetId, "custom">) => {
    const meta = DRILL_PRESETS[presetId];
    onChangeConfig((prev) => ({
      ...structuredClone(meta.config),
      mode: prev.mode,
      blindVoiceMode: prev.blindVoiceMode,
      speechRate: prev.speechRate,
      targetMs: presetId === "desk_pro" ? settings.targetMs : meta.config.targetMs,
    }));
  };

  const toggleOp = (op: Operation) => {
    onChangeConfig((prev) => {
      const exists = prev.operations.includes(op);
      const nextOps = exists
        ? prev.operations.filter((x) => x !== op)
        : [...prev.operations, op];
      if (nextOps.length === 0) return prev;
      return { ...prev, preset: "custom", operations: nextOps };
    });
  };

  const correctSoFar = attempts.filter((a) => a.status === "correct").length;
  const meanSoFarMs =
    attempts.length > 0
      ? Math.round(
          attempts.reduce((s, a) => s + a.reactionMs, 0) / attempts.length,
        )
      : 0;
  const ppmSoFar =
    elapsedMs > 1500 ? ((correctSoFar / elapsedMs) * 60_000).toFixed(1) : "0.0";
  const accuracySoFar =
    attempts.length > 0 ? Math.round((correctSoFar / attempts.length) * 100) : 100;

  const paceRatio = Math.min(1, problemElapsedMs / Math.max(500, config.targetMs));
  const paceClass =
    problemElapsedMs > config.targetMs
      ? "pace-fill is-over"
      : paceRatio > 0.72
        ? "pace-fill is-warn"
        : "pace-fill";

  if (phase === "running" && currentProblem) {
    const timeLabel =
      config.format === "timed"
        ? `${Math.max(0, Math.ceil((config.durationSec * 1000 - elapsedMs) / 1000))}s`
        : `${(elapsedMs / 1000).toFixed(1)}s`;
    const progressLabel =
      config.format === "fixed"
        ? `${attempts.length + 1} / ${config.questionCount}`
        : `#${attempts.length + 1}`;
    const showVisualEquation =
      config.mode === "visual" || !config.blindVoiceMode || peekVisual;

    return (
      <div className="stack-lg">
        <div className="hud-strip">
          <div className="hud-metric">
            <span className="hud-label">
              {config.format === "timed" ? "Remaining" : "Elapsed"} · {progressLabel}
            </span>
            <span className="hud-value tabular">{timeLabel}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-label">Speed (Q / min)</span>
            <span className="hud-value tabular">{ppmSoFar}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-label">Avg Solve</span>
            <span className="hud-value tabular">
              {meanSoFarMs > 0 ? `${(meanSoFarMs / 1000).toFixed(2)}s` : "—"}
            </span>
          </div>
          <div className="hud-metric">
            <span className="hud-label">Accuracy · Streak</span>
            <span className="hud-value tabular">
              {accuracySoFar}% · {streak}
            </span>
          </div>
        </div>

        <section className="problem-card" aria-label="Active math problem">
          <div className="stage-top-bar">
            <span className="status-pill is-neutral">
              {config.mode === "visual" ? (
                <>
                  <Eye size={14} aria-hidden="true" /> Visual Mode
                </>
              ) : config.mode === "voice_keys" ? (
                <>
                  <Headphones size={14} aria-hidden="true" /> Audio + Keys (
                  {config.speechRate}×)
                </>
              ) : (
                <>
                  <Mic size={14} aria-hidden="true" /> Hands-Free Voice (
                  {config.speechRate}×)
                </>
              )}
            </span>

            <div className="toolbar">
              {config.mode !== "visual" && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={replayAudio}
                  >
                    <Volume2 size={15} aria-hidden="true" /> Repeat (R)
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setPeekVisual((v) => !v);
                      inputRef.current?.focus();
                    }}
                  >
                    {peekVisual ? (
                      <>
                        <EyeOff size={15} aria-hidden="true" /> Hide (V)
                      </>
                    ) : (
                      <>
                        <Eye size={15} aria-hidden="true" /> Peek (V)
                      </>
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => submitAttempt("skipped", null, inputVal || "[skipped]")}
              >
                <SkipForward size={15} aria-hidden="true" /> Skip (Space)
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void finishSession(attemptsRef.current)}
              >
                <Square size={14} aria-hidden="true" /> End Drill (Esc)
              </button>
            </div>
          </div>

          <div className="pace-track" aria-hidden="true">
            <div
              className={paceClass}
              style={{ transform: `scaleX(${paceRatio.toFixed(3)})` }}
            />
          </div>

          {config.mode !== "visual" && (
            <div className="voice-stage-box">
              <span
                className={`voice-status-badge ${
                  isSpeaking || isListening ? "is-active" : ""
                }`}
              >
                {isSpeaking ? (
                  <>
                    <Volume2 size={15} aria-hidden="true" /> Speaking equation…
                  </>
                ) : config.mode === "voice_handsfree" ? (
                  isListening ? (
                    <>
                      <Mic size={15} aria-hidden="true" /> Listening for spoken
                      integer…
                    </>
                  ) : (
                    <>
                      <MicOff size={15} aria-hidden="true" /> Mic standby (type
                      or speak)
                    </>
                  )
                ) : (
                  <>
                    <Keyboard size={15} aria-hidden="true" /> Audio ready — type
                    integer answer
                  </>
                )}
              </span>

              {!ttsSupported && !settings.cloudTtsEnabled && (
                <p className="hint">
                  Speech synthesis unavailable in this browser; showing equation
                  automatically.
                </p>
              )}
              {micError && <p className="hint">{micError}</p>}
              {liveTranscript && (
                <p className="hint mono" aria-live="polite">
                  Heard: &ldquo;{liveTranscript}&rdquo;
                </p>
              )}
            </div>
          )}

          {showVisualEquation || (!ttsSupported && !settings.cloudTtsEnabled) ? (
            <div className="equation-display" aria-label={currentProblem.spokenText}>
              {currentProblem.displayText}
            </div>
          ) : (
            <div className="equation-display" aria-label="Blind audio mode active">
              <span className="hint" style={{ fontSize: "1.05rem" }}>
                Blind Audio Active — tap <strong>Peek</strong> or press{" "}
                <strong>V</strong>
              </span>
            </div>
          )}

          <form className="answer-form" onSubmit={handleFormSubmit}>
            {config.ranges.sub.allowNegative && (
              <button
                type="button"
                className="btn"
                aria-label="Toggle negative sign"
                style={{
                  minBlockSize: "56px",
                  minInlineSize: "50px",
                  fontSize: "1.25rem",
                  fontWeight: 700,
                }}
                onClick={() => {
                  handleInputChange(
                    inputVal.startsWith("-") ? inputVal.slice(1) : `-${inputVal}`,
                  );
                  inputRef.current?.focus();
                }}
              >
                ±
              </button>
            )}
            <label htmlFor="drill-answer-input" className="visually-hidden">
              Integer answer
            </label>
            <input
              ref={inputRef}
              id="drill-answer-input"
              className="answer-input"
              type="text"
              inputMode="numeric"
              pattern="-?[0-9]*"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              value={inputVal}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                config.submissionMode === "enter" ? "Answer" : "Type answer"
              }
            />
            {config.submissionMode === "enter" && (
              <button
                type="submit"
                className="btn btn-primary"
                style={{ minBlockSize: "56px" }}
              >
                Submit
              </button>
            )}
          </form>

          <div className="badge-row">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={showKeypad}
              onClick={() => setShowKeypad((k) => !k)}
            >
              {showKeypad ? "Hide Keypad" : "Touch Keypad"}
            </button>
            <span className="hint">
              Pace target: {(config.targetMs / 1000).toFixed(1)}s · Current:{" "}
              <span className="mono">{(problemElapsedMs / 1000).toFixed(1)}s</span>
            </span>
          </div>

          {showKeypad && (
            <div className="keypad-grid" role="group" aria-label="Numeric keypad">
              {["7", "8", "9", "4", "5", "6", "1", "2", "3", "-", "0", "⌫"].map(
                (key) => (
                  <button
                    key={key}
                    type="button"
                    className="keypad-btn"
                    onClick={() => {
                      if (key === "⌫") {
                        handleInputChange(inputVal.slice(0, -1));
                      } else if (key === "-") {
                        handleInputChange(
                          inputVal.startsWith("-")
                            ? inputVal.slice(1)
                            : `-${inputVal}`,
                        );
                      } else {
                        handleInputChange(`${inputVal}${key}`);
                      }
                      inputRef.current?.focus();
                    }}
                  >
                    {key}
                  </button>
                ),
              )}
            </div>
          )}

          <div
            className={`feedback-banner ${
              feedback
                ? feedback.kind === "ok"
                  ? "feedback-ok"
                  : feedback.kind === "warn"
                    ? "feedback-warn"
                    : "feedback-err"
                : ""
            }`}
            aria-live="polite"
            style={{ visibility: feedback ? "visible" : "hidden" }}
          >
            {feedback?.kind === "ok" && (
              <CheckCircle2 size={16} aria-hidden="true" />
            )}
            {feedback?.kind === "warn" && <Clock size={16} aria-hidden="true" />}
            {feedback?.kind === "err" && <XCircle size={16} aria-hidden="true" />}
            <span>{feedback?.text ?? "Ready"}</span>
          </div>
        </section>

        {attempts.length > 0 && (
          <section className="panel" aria-label="Recent attempt tape">
            <h2
              className="section-title"
              style={{ fontSize: "0.9375rem", marginBlockEnd: "0.65rem" }}
            >
              Live Attempt Tape (Latest 5)
            </h2>
            <div className="attempt-tape">
              {[...attempts]
                .reverse()
                .slice(0, 5)
                .map((att) => (
                  <div key={att.seq} className="tape-row">
                    <span className="mono">
                      #{att.seq} · {formatProblemDisplay(att.op, att.a, att.b)} ={" "}
                      <strong>{att.correctAnswer}</strong>
                    </span>
                    <span className="badge-row">
                      {att.status === "correct" ? (
                        <span
                          className={`status-pill ${att.isSlow ? "is-warn" : "is-ok"}`}
                        >
                          {att.isSlow ? "Slow" : "Exact"} ·{" "}
                          {(att.reactionMs / 1000).toFixed(2)}s
                        </span>
                      ) : (
                        <span className="status-pill is-err">
                          {att.status === "wrong"
                            ? `Entered ${att.userAnswer}`
                            : att.status}{" "}
                          · {(att.reactionMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (phase === "summary") {
    const total = attempts.length;
    const correct = attempts.filter((a) => a.status === "correct").length;
    const issues = savedAttempts.filter(
      (a) => a.status !== "correct" || a.isSlow,
    );
    const fallbackIssues = attempts.filter(
      (a) => a.status !== "correct" || a.isSlow,
    );
    const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";
    const latencies = attempts.map((a) => a.reactionMs).sort((x, y) => x - y);
    const meanMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
        : 0;
    const p90Ms =
      latencies.length > 0
        ? latencies[
            Math.min(latencies.length - 1, Math.ceil(0.9 * latencies.length) - 1)
          ]
        : 0;

    return (
      <div className="stack-lg">
        <section className="panel" aria-labelledby="debrief-heading">
          <div className="section-header">
            <div>
              <h2 id="debrief-heading" className="section-title">
                Session Debrief
              </h2>
              <p className="section-sub">
                {isSaving
                  ? "Saving telemetry and computing mistake tricks…"
                  : savingError
                    ? `Saved locally only (${savingError})`
                    : `Logged to ${settings.storageBackend === "gcp" ? "Firestore" : "store"} · ${config.mode.replace("_", " ")}`}
              </p>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-primary"
                onClick={startSession}
              >
                <RotateCcw size={16} aria-hidden="true" /> Run Again
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onChangeConfig((prev) => ({
                    ...prev,
                    ...structuredClone(DRILL_PRESETS.weakness_drill.config),
                    mode: prev.mode,
                    blindVoiceMode: prev.blindVoiceMode,
                    speechRate: prev.speechRate,
                    operationWeights: weaknessWeights,
                  }));
                  setPhase("setup");
                }}
              >
                <Sparkles size={16} aria-hidden="true" /> Configure Weakness Drill
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onOpenMistakes(savedSession?.id)}
              >
                Review All Mistakes ({issues.length || fallbackIssues.length})
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setPhase("setup")}
              >
                Back to Setup
              </button>
            </div>
          </div>

          <div className="hud-strip">
            <div className="hud-metric">
              <span className="hud-label">Score</span>
              <span className="hud-value tabular">
                {correct} / {total}
              </span>
            </div>
            <div className="hud-metric">
              <span className="hud-label">Throughput</span>
              <span className="hud-value tabular">
                {savedSession
                  ? savedSession.ppm
                  : ((correct / Math.max(1000, elapsedMs)) * 60_000).toFixed(1)}{" "}
                Q/min
              </span>
            </div>
            <div className="hud-metric">
              <span className="hud-label">Accuracy</span>
              <span className="hud-value tabular">{accuracy}%</span>
            </div>
            <div className="hud-metric">
              <span className="hud-label">Mean / P90 Latency</span>
              <span className="hud-value tabular">
                {(meanMs / 1000).toFixed(2)}s / {(p90Ms / 1000).toFixed(2)}s
              </span>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="debrief-issues-heading">
          <div className="section-header">
            <div>
              <h3 id="debrief-issues-heading" className="section-title">
                Mistakes &amp; Slow Solves (
                {savedAttempts.length ? issues.length : fallbackIssues.length})
              </h3>
              <p className="section-sub">
                Every wrong, skipped, timed-out, or over-pace problem includes an
                algorithmic mental shortcut.
              </p>
            </div>
          </div>

          {(savedAttempts.length ? issues : fallbackIssues).length === 0 ? (
            <div className="feedback-banner feedback-ok">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>
                Clean sprint — 100% accurate and every solve inside your{" "}
                {(config.targetMs / 1000).toFixed(1)}s pace target!
              </span>
            </div>
          ) : (
            <div className="attempt-tape">
              {(savedAttempts.length > 0 ? issues : fallbackIssues).map(
                (item, idx) => {
                  const isPersisted = "id" in item;
                  const trick = analyzeProblemTrick(
                    item.op,
                    item.a,
                    item.b,
                    item.correctAnswer,
                  );
                  const errCat = isPersisted
                    ? item.errorCategory
                    : classifyAttemptError({
                        status: item.status,
                        correctAnswer: item.correctAnswer,
                        userAnswer: item.userAnswer,
                        reactionMs: item.reactionMs,
                        targetMs: config.targetMs,
                      });
                  return (
                    <div
                      key={isPersisted ? item.id : idx}
                      className="panel-subtle"
                      style={{ display: "grid", gap: "0.45rem" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "0.75rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          className="mono"
                          style={{ fontSize: "1.05rem", fontWeight: 700 }}
                        >
                          {formatProblemDisplay(item.op, item.a, item.b)} ={" "}
                          {item.correctAnswer}
                        </span>
                        <div className="badge-row">
                          <span
                            className={`status-pill ${
                              item.status === "correct" ? "is-warn" : "is-err"
                            }`}
                          >
                            {ERROR_CATEGORY_LABEL[errCat]} ·{" "}
                            {(item.reactionMs / 1000).toFixed(2)}s
                          </span>
                          {item.userAnswer !== null && item.status === "wrong" && (
                            <span className="status-pill is-neutral">
                              Yours: {item.userAnswer}
                            </span>
                          )}
                          {isPersisted && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onAskCoachAboutAttempt(item.id)}
                            >
                              Ask Gemini Coach
                            </button>
                          )}
                        </div>
                      </div>
                      <p
                        style={{
                          fontSize: "0.875rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <strong>{trick.strategyName}:</strong>{" "}
                        {trick.steps.join(" ")}
                      </p>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <section className="panel" aria-labelledby="setup-heading">
        <div className="section-header">
          <div>
            <h2 id="setup-heading" className="section-title">
              Configure Mental Math Drill
            </h2>
            <p className="section-sub">
              Pure integer arithmetic (+, −, ×, ÷) calibrated for quant desk
              speed and auditory retention.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={config.operations.length === 0}
            onClick={startSession}
          >
            <Play size={16} aria-hidden="true" /> Start Drill
          </button>
        </div>

        <div className="config-grid">
          <fieldset className="control-group">
            <legend>1. Training Mode</legend>
            <div className="badge-row">
              <div className="choice-chip">
                <input
                  type="radio"
                  id="mode-visual"
                  name="train-mode"
                  checked={config.mode === "visual"}
                  onChange={() =>
                    onChangeConfig((c) => ({ ...c, mode: "visual" }))
                  }
                />
                <label htmlFor="mode-visual">
                  <Eye size={15} aria-hidden="true" /> Visual
                </label>
              </div>
              <div className="choice-chip">
                <input
                  type="radio"
                  id="mode-voice-keys"
                  name="train-mode"
                  checked={config.mode === "voice_keys"}
                  onChange={() =>
                    onChangeConfig((c) => ({ ...c, mode: "voice_keys" }))
                  }
                />
                <label htmlFor="mode-voice-keys">
                  <Headphones size={15} aria-hidden="true" /> Voice: Audio + Keys
                </label>
              </div>
              <div className="choice-chip">
                <input
                  type="radio"
                  id="mode-voice-hf"
                  name="train-mode"
                  checked={config.mode === "voice_handsfree"}
                  onChange={() =>
                    onChangeConfig((c) => ({ ...c, mode: "voice_handsfree" }))
                  }
                />
                <label htmlFor="mode-voice-hf">
                  <Mic size={15} aria-hidden="true" /> Voice: Hands-Free
                </label>
              </div>
            </div>
            {config.mode !== "visual" && (
              <div
                style={{
                  marginBlockStart: "0.65rem",
                  display: "grid",
                  gap: "0.45rem",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={config.blindVoiceMode}
                    onChange={(e) =>
                      onChangeConfig((c) => ({
                        ...c,
                        blindVoiceMode: e.target.checked,
                      }))
                    }
                  />
                  Blind Audio Mode (hide visual equation until Peek)
                </label>
                {config.mode === "voice_handsfree" && !speechRecSupported && (
                  <p className="hint">
                    Note: SpeechRecognition is unavailable on this browser;
                    Audio-Prompt + Keyboard/Keypad stays active automatically.
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="control-group">
            <legend>2. Answer Submission &amp; Speed Discipline</legend>
            <div className="badge-row">
              {(
                [
                  { id: "enter", label: "Enter Key (Log Wrong Answers)" },
                  { id: "length_auto", label: "Auto at Digit Length" },
                  { id: "exact_auto", label: "Exact Match Auto (Zetamac)" },
                ] as Array<{ id: SubmissionMode; label: string }>
              ).map((item) => (
                <div key={item.id} className="choice-chip">
                  <input
                    type="radio"
                    id={`sub-${item.id}`}
                    name="submission-mode"
                    checked={config.submissionMode === item.id}
                    onChange={() =>
                      onChangeConfig((c) => ({ ...c, submissionMode: item.id }))
                    }
                  />
                  <label htmlFor={`sub-${item.id}`}>{item.label}</label>
                </div>
              ))}
            </div>
            <div
              style={{
                marginBlockStart: "0.65rem",
                display: "flex",
                alignItems: "center",
                gap: "0.65rem",
                flexWrap: "wrap",
              }}
            >
              <label
                htmlFor="q-timeout-select"
                style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}
              >
                Per-question cutoff:
              </label>
              <select
                id="q-timeout-select"
                className="select"
                style={{ maxInlineSize: "240px" }}
                value={perQuestionTimeoutSec}
                onChange={(e) => setPerQuestionTimeoutSec(Number(e.target.value))}
              >
                <option value={0}>No cutoff (track slow solves)</option>
                <option value={4}>4s strict cutoff</option>
                <option value={6}>6s cutoff</option>
                <option value={10}>10s cutoff</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="control-group">
            <legend>3. Operations &amp; Sign Rules</legend>
            <div className="badge-row">
              {(["add", "sub", "mul", "div"] as Operation[]).map((op) => (
                <div key={op} className="choice-chip">
                  <input
                    type="checkbox"
                    id={`op-${op}`}
                    checked={config.operations.includes(op)}
                    onChange={() => toggleOp(op)}
                  />
                  <label htmlFor={`op-${op}`}>
                    <span className="mono">{OP_SYMBOL[op]}</span> {OP_LABEL[op]}
                  </label>
                </div>
              ))}
            </div>
            <div style={{ marginBlockStart: "0.65rem" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={config.ranges.sub.allowNegative}
                  onChange={(e) =>
                    onChangeConfig((c) => ({
                      ...c,
                      preset: "custom",
                      ranges: {
                        ...c.ranges,
                        sub: {
                          ...c.ranges.sub,
                          allowNegative: e.target.checked,
                        },
                      },
                    }))
                  }
                />
                Allow negative subtraction results (e.g. 154 − 353 = −199)
              </label>
            </div>
          </fieldset>
        </div>

        {/* Subgrid Preset Cards */}
        <div style={{ marginBlockStart: "1.25rem" }}>
          <h3
            style={{
              fontSize: "0.78rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-secondary)",
              marginBlockEnd: "0.55rem",
            }}
          >
            4. Quant Drill Presets
          </h3>
          <div className="preset-grid-cards">
            {(Object.keys(DRILL_PRESETS) as Array<Exclude<PresetId, "custom">>).map(
              (id) => {
                const preset = DRILL_PRESETS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className="subgrid-card"
                    aria-pressed={config.preset === id}
                    onClick={() => applyPreset(id)}
                  >
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-desc">{preset.subtitle}</span>
                    <span className="status-pill is-neutral">{preset.badge}</span>
                  </button>
                );
              },
            )}
          </div>
        </div>

        <div
          style={{
            marginBlockStart: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRangeModalOpen(true)}
          >
            <Sliders size={14} aria-hidden="true" /> Customize Operand Ranges
            &amp; Timer
          </button>

          <span className="hint">
            Pace Target:{" "}
            <strong className="mono">
              {(config.targetMs / 1000).toFixed(1)}s
            </strong>{" "}
            · Format:{" "}
            <strong>
              {config.format === "timed"
                ? `${config.durationSec}s Timed`
                : config.format === "fixed"
                  ? `${config.questionCount} Questions`
                  : "Endless Flow"}
            </strong>
          </span>
        </div>
      </section>

      <CustomRangeModal
        open={rangeModalOpen}
        onClose={() => setRangeModalOpen(false)}
        config={config}
        onApply={(next) => onChangeConfig(next)}
      />
    </div>
  );
}
