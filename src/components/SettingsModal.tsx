"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Eye, EyeOff, Trash2 } from "lucide-react";
import type { PublicSettings } from "@/lib/math";
import { api } from "@/lib/client/api";
import { listEnglishVoices } from "@/lib/client/audioEngine";
import { attachValidationSync } from "@/lib/client/validation";
import { NativeDialog } from "./NativeDialog";

export type ThemePreference = "system" | "light" | "dark";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: PublicSettings;
  onSettingsUpdated: (next: PublicSettings) => void;
  themePref: ThemePreference;
  systemDark: boolean;
  onThemeChange: (pref: ThemePreference) => void;
  onDataReset: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, onClose, settings } = props;
  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      titleId="settings-dialog-title"
      title="DeskMath Settings & Google Cloud AI"
      wide
    >
      <SettingsFormBody
        key={`${String(open)}-${settings.targetMs}-${settings.speechRate}-${settings.aiProvider}-${String(settings.hasApiKey)}-${String(settings.cloudTtsEnabled)}`}
        {...props}
        requestClose={onClose}
      />
    </NativeDialog>
  );
}

function SettingsFormBody({
  settings,
  onSettingsUpdated,
  themePref,
  systemDark,
  onThemeChange,
  onDataReset,
  requestClose,
}: SettingsModalProps & { requestClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  const [targetMs, setTargetMs] = useState(String(settings.targetMs));
  const [speechRate, setSpeechRate] = useState(settings.speechRate);
  const [voiceName, setVoiceName] = useState(settings.voiceName);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [cloudTtsEnabled, setCloudTtsEnabled] = useState(settings.cloudTtsEnabled);
  const [aiProvider, setAiProvider] = useState(settings.aiProvider);
  const [geminiPrimaryModel, setGeminiPrimaryModel] = useState(
    settings.geminiPrimaryModel,
  );
  const [geminiLiteModel, setGeminiLiteModel] = useState(settings.geminiLiteModel);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    listEnglishVoices(),
  );
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    return attachValidationSync(form);
  }, []);

  useEffect(() => {
    const loadVoices = () => setVoices(listEnglishVoices());
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
      return () =>
        window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    }
    return undefined;
  }, []);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateSettings({
        targetMs: Number.parseInt(targetMs, 10),
        speechRate,
        voiceName,
        soundEnabled,
        cloudTtsEnabled,
        aiProvider,
        geminiPrimaryModel,
        geminiLiteModel,
        geminiApiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
      });
      onSettingsUpdated(updated);
      requestClose();
    } finally {
      setSaving(false);
    }
  };

  const handleTestGemini = async () => {
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await api.testGeminiConnection({
        model: geminiLiteModel,
        apiKey: apiKeyInput.trim() || undefined,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTestingAi(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSave} className="stack-lg">
      <div className="badge-row">
        <span className="status-pill is-neutral">
          Storage Backend:{" "}
          <strong>
            {settings.storageBackend === "gcp"
              ? "Cloud Firestore + GCS"
              : "Local JSON (.local-data)"}
          </strong>
        </span>
      </div>

      <fieldset className="control-group">
        <legend>Color Theme</legend>
        <div className="badge-row">
          {(
            [
              {
                id: "system",
                label: `System (Currently ${systemDark ? "dark" : "light"})`,
              },
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ] as Array<{ id: ThemePreference; label: string }>
          ).map((opt) => (
            <div key={opt.id} className="choice-chip">
              <input
                type="radio"
                id={`theme-${opt.id}`}
                name="theme-pref"
                checked={themePref === opt.id}
                onChange={() => onThemeChange(opt.id)}
              />
              <label htmlFor={`theme-${opt.id}`}>{opt.label}</label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="dialog-review-grid">
        <div className="field">
          <label htmlFor="set-target-ms">Slow-Solve Threshold (800–15000 ms)</label>
          <span id="set-target-hint" className="hint">
            Correct answers slower than this flag for review.
          </span>
          <input
            id="set-target-ms"
            className="input mono"
            type="text"
            inputMode="numeric"
            required
            pattern="^(?:[89][0-9]{2}|[1-9][0-9]{3}|1[0-4][0-9]{3}|15000)$"
            aria-describedby="set-target-hint"
            data-error="set-target-err"
            value={targetMs}
            onChange={(e) => setTargetMs(e.target.value)}
          />
          <div id="set-target-err" className="field-error-msg">
            <AlertCircle size={14} aria-hidden="true" />
            <span>Error: Enter a threshold between 800 and 15000 ms.</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="set-speech-rate">
            Voice Speech Rate ({speechRate.toFixed(2)}×)
          </label>
          <span className="hint">Quant desks typically train at 1.2×–1.5×.</span>
          <input
            id="set-speech-rate"
            type="range"
            min="0.8"
            max="2.0"
            step="0.05"
            value={speechRate}
            onChange={(e) => setSpeechRate(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="dialog-review-grid">
        <div className="field">
          <label htmlFor="set-voice">Browser Synthesis Voice</label>
          <select
            id="set-voice"
            className="select"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
          >
            <option value="">Default English Voice</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>

        <div className="stack-lg" style={{ gap: "0.45rem", alignSelf: "end" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
            />
            Play tactile audio cues on hit / miss
          </label>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            <input
              type="checkbox"
              checked={cloudTtsEnabled}
              onChange={(e) => setCloudTtsEnabled(e.target.checked)}
            />
            Prefer Google Cloud Neural TTS (auto-falls back to Web Speech)
          </label>
        </div>
      </div>

      {/* Pure Google Gemini Coach Settings */}
      <div className="panel-subtle stack-lg" style={{ gap: "0.75rem" }}>
        <div>
          <strong style={{ fontSize: "0.9375rem" }}>
            Quant Coach Engine (Built-in + Google Gemini API)
          </strong>
          <p className="hint">
            Uses Secret Manager <code>GEMINI_API_KEY</code> on Cloud Run (or an optional key saved below), routing diagnostics to Primary and quick Q&amp;A to Lite.
          </p>
        </div>

        <div className="field">
          <label htmlFor="set-ai-provider">Active Coach Mode</label>
          <select
            id="set-ai-provider"
            className="select"
            value={aiProvider}
            onChange={(e) =>
              setAiProvider(e.target.value as PublicSettings["aiProvider"])
            }
          >
            <option value="builtin">
              Deterministic Quant Math Engine (Zero Latency / Offline)
            </option>
            <option value="gemini">
              Google AI Gemini (Tiered Primary + Lite Models)
            </option>
          </select>
        </div>

        {aiProvider === "gemini" && (
          <>
            <div className="dialog-review-grid">
              <div className="field">
                <label htmlFor="set-gemini-primary">
                  Primary Model (Diagnostics &amp; Plans)
                </label>
                <input
                  id="set-gemini-primary"
                  className="input mono"
                  type="text"
                  required
                  value={geminiPrimaryModel}
                  onChange={(e) => setGeminiPrimaryModel(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="set-gemini-lite">
                  Lite Model (Fast Mistake Q&amp;A)
                </label>
                <input
                  id="set-gemini-lite"
                  className="input mono"
                  type="text"
                  required
                  value={geminiLiteModel}
                  onChange={(e) => setGeminiLiteModel(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="set-gemini-key">
                Gemini API Key{" "}
                {settings.hasApiKey ? `(Configured: ${settings.maskedApiKey})` : ""}
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="set-gemini-key"
                  className="input mono"
                  style={{ flex: 1 }}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    settings.hasApiKey
                      ? "Leave blank to keep Secret Manager / saved key"
                      : "Paste Google AI Studio Gemini key"
                  }
                />
                <button
                  type="button"
                  className="btn"
                  aria-pressed={showKey}
                  aria-label={showKey ? "Hide Gemini key" : "Show Gemini key"}
                  onClick={() => setShowKey((s) => !s)}
                >
                  {showKey ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="badge-row">
              <button
                type="button"
                className="btn btn-sm"
                disabled={testingAi}
                onClick={() => void handleTestGemini()}
              >
                {testingAi ? "Testing Gemini…" : "Test Gemini Connection"}
              </button>
              {settings.hasApiKey && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    const updated = await api.updateSettings({
                      geminiApiKey: null,
                    });
                    onSettingsUpdated(updated);
                    setTestResult({
                      ok: true,
                      message: "Cleared custom Gemini key override.",
                    });
                  }}
                >
                  Clear Custom Key
                </button>
              )}
            </div>

            {testResult && (
              <div
                className={`feedback-banner ${
                  testResult.ok ? "feedback-ok" : "feedback-err"
                }`}
              >
                <span>{testResult.message}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <a className="btn btn-sm" href="/api/export" download="deskmath-export.json">
          <Download size={14} aria-hidden="true" /> Export JSON Backup
        </a>

        {!confirmReset ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => setConfirmReset(true)}
          >
            <Trash2 size={14} aria-hidden="true" /> Reset Training History
          </button>
        ) : (
          <div className="badge-row">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={async () => {
                await api.resetTrainingData();
                setConfirmReset(false);
                onDataReset();
                requestClose();
              }}
            >
              Confirm Wipe All Data
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="dialog-footer">
        <button type="button" className="btn" onClick={requestClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
