import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Trash2, X } from 'lucide-react';
import { api, type PublicSettings } from '../api/client.js';
import { listEnglishVoices } from '../utils/audioEngine.js';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: PublicSettings;
  onSettingsUpdated: (next: PublicSettings) => void;
  themePref: ThemePreference;
  systemDark: boolean;
  onThemeChange: (pref: ThemePreference) => void;
  onDataReset: () => void;
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  onSettingsUpdated,
  themePref,
  systemDark,
  onThemeChange,
  onDataReset,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync React open prop with native <dialog> showModal()
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without native dialog.closedBy support
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = outside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e)) dialog.close();
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="settings-title"
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        onClose();
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <SettingsFormBody
        key={`${String(open)}-${settings.targetMs}-${settings.speechRate}-${settings.aiProvider}-${String(settings.hasApiKey)}`}
        dialogRef={dialogRef}
        onClose={onClose}
        settings={settings}
        onSettingsUpdated={onSettingsUpdated}
        themePref={themePref}
        systemDark={systemDark}
        onThemeChange={onThemeChange}
        onDataReset={onDataReset}
      />
    </dialog>
  );
}

function SettingsFormBody({
  dialogRef,
  onClose,
  settings,
  onSettingsUpdated,
  themePref,
  systemDark,
  onThemeChange,
  onDataReset,
}: Omit<SettingsDialogProps, 'open'> & { dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const [targetMs, setTargetMs] = useState(settings.targetMs);
  const [speechRate, setSpeechRate] = useState(settings.speechRate);
  const [voiceName, setVoiceName] = useState(settings.voiceName);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [aiProvider, setAiProvider] = useState(settings.aiProvider);
  const [aiModel, setAiModel] = useState(settings.aiModel);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listEnglishVoices());
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const loadVoices = () => setVoices(listEnglishVoices());
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    }
    return undefined;
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        targetMs,
        speechRate,
        voiceName,
        soundEnabled,
        aiProvider,
        aiModel,
        aiApiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
      });
      onSettingsUpdated(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    if (aiProvider === 'builtin') return;
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await api.testAiConnection({
        provider: aiProvider,
        model: aiModel,
        apiKey: apiKeyInput.trim() || undefined,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTestingAi(false);
    }
  };

  return (
    <div className="dialog-body scroller">
        <div className="dialog-header">
          <h2 id="settings-title" className="section-title">
            DeskMath Settings &amp; AI Coach
          </h2>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Close settings"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={16} aria-hidden="true" /> Close
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'grid', gap: '1.1rem' }}>
          {/* 3-State Theme Selector per dark-mode-toggle guide */}
          <fieldset className="control-group">
            <legend>Color Theme</legend>
            <div className="chip-row">
              {(
                [
                  {
                    id: 'system',
                    label: `System (Currently ${systemDark ? 'dark' : 'light'})`,
                  },
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div className="field">
              <label htmlFor="set-target-ms">Slow-Solve Threshold (ms)</label>
              <input
                id="set-target-ms"
                className="input mono"
                type="text"
                inputMode="numeric"
                value={targetMs}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
                  if (!Number.isNaN(v)) setTargetMs(v);
                }}
              />
              <span className="hint">Correct solves slower than this flag for review.</span>
            </div>

            <div className="field">
              <label htmlFor="set-speech-rate">Voice Speech Rate ({speechRate.toFixed(2)}×)</label>
              <input
                id="set-speech-rate"
                type="range"
                min="0.8"
                max="2.0"
                step="0.05"
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
              />
              <span className="hint">Quant desks typically train at 1.2×–1.5×.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="set-voice">Voice Synthesis Speaker</label>
            <select
              id="set-voice"
              className="select"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
            >
              <option value="">Browser Default English Voice</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9375rem' }}>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
            />
            Play tactile audio cues on hit / miss
          </label>

          {/* Optional BYO LLM Coach */}
          <div className="panel-subtle" style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
              <strong style={{ fontSize: '0.9375rem' }}>Coach Suggestion Provider</strong>
              <p className="hint">
                Built-in quant trick analyzer works offline with zero keys. Optionally connect OpenAI or Gemini for conversational coaching.
              </p>
            </div>

            <div className="field">
              <label htmlFor="set-ai-provider">Provider</label>
              <select
                id="set-ai-provider"
                className="select"
                value={aiProvider}
                onChange={(e) => {
                  const next = e.target.value as PublicSettings['aiProvider'];
                  setAiProvider(next);
                  if (next === 'openai' && (!aiModel || aiModel.startsWith('gemini'))) {
                    setAiModel('gpt-4o-mini');
                  } else if (next === 'gemini' && (!aiModel || aiModel.startsWith('gpt'))) {
                    setAiModel('gemini-2.5-flash');
                  }
                }}
              >
                <option value="builtin">Built-in Quant Math Engine (Recommended / Free)</option>
                <option value="openai">OpenAI (BYO API Key)</option>
                <option value="gemini">Google Gemini (BYO API Key)</option>
              </select>
            </div>

            {aiProvider !== 'builtin' && (
              <>
                <div className="field">
                  <label htmlFor="set-ai-model">Model</label>
                  <input
                    id="set-ai-model"
                    className="input mono"
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="set-ai-key">
                    API Key {settings.hasApiKey ? `(Saved: ${settings.maskedApiKey})` : ''}
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      id="set-ai-key"
                      className="input mono"
                      style={{ flex: 1 }}
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={settings.hasApiKey ? 'Enter new key to replace saved key' : 'Paste API key'}
                    />
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={showKey}
                      aria-label={showKey ? 'Hide API key' : 'Show API key'}
                      onClick={() => setShowKey((s) => !s)}
                    >
                      {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <div className="chip-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={testingAi}
                    onClick={handleTestAi}
                  >
                    {testingAi ? 'Testing…' : 'Test Connection'}
                  </button>
                  {settings.hasApiKey && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const updated = await api.updateSettings({ aiApiKey: null });
                        onSettingsUpdated(updated);
                        setTestResult({ ok: true, message: 'Cleared saved API key.' });
                      }}
                    >
                      Clear Saved Key
                    </button>
                  )}
                </div>

                {testResult && (
                  <div className={`feedback-banner ${testResult.ok ? 'feedback-ok' : 'feedback-err'}`}>
                    <span>{testResult.message}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Data Export & Reset */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <a className="btn btn-sm" href="/api/export" download="quant-math-export.json">
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
              <div className="chip-row">
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    await api.resetTrainingData();
                    setConfirmReset(false);
                    onDataReset();
                    onClose();
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
            <button
              type="button"
              className="btn"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
  );
}
