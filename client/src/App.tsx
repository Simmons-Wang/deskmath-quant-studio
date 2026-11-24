import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Brain, Download, Settings, Zap } from 'lucide-react';
import {
  createDefaultDrillConfig,
  DRILL_PRESETS,
  type DrillConfig,
} from '../../shared/math.js';
import {
  api,
  type OverviewStats,
  type PublicSettings,
  type RecommendedDrill,
  type WeaknessProfile,
} from './api/client.js';
import { AnalyticsView } from './components/AnalyticsView.js';
import { MistakesCoachView } from './components/MistakesCoachView.js';
import { SettingsDialog, type ThemePreference } from './components/SettingsDialog.js';
import { TrainArena } from './components/TrainArena.js';

type TabId = 'train' | 'mistakes' | 'analytics';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function readInitialTheme(): ThemePreference {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

function applyThemeToMeta(pref: ThemePreference): void {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', pref === 'system' ? 'light dark' : pref);
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('train');
  const [config, setConfig] = useState<DrillConfig>(createDefaultDrillConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [canInstall, setCanInstall] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    typeof (Navigator.prototype as unknown as { install?: () => Promise<void> }).install ===
      'function',
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  const [themePref, setThemePref] = useState<ThemePreference>(readInitialTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  const [settings, setSettings] = useState<PublicSettings>({
    targetMs: 3500,
    speechRate: 1.25,
    voiceName: '',
    soundEnabled: true,
    aiProvider: 'builtin',
    aiModel: 'gpt-4o-mini',
    hasApiKey: false,
    maskedApiKey: null,
  });
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [weakness, setWeakness] = useState<WeaknessProfile | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [sessionFilter, setSessionFilter] = useState<string>('');
  const [coachAttemptId, setCoachAttemptId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    train: null,
    mistakes: null,
    analytics: null,
  });

  const announce = useCallback((msg: string) => {
    setLiveMessage('');
    requestAnimationFrame(() => setLiveMessage(msg));
  }, []);

  // Theme media listener & cross-tab storage sync per dark-mode-toggle guide
  useEffect(() => {
    applyThemeToMeta(themePref);
  }, [themePref]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMqChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onMqChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next: ThemePreference =
          e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system';
        setThemePref(next);
        applyThemeToMeta(next);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleThemeChange = (pref: ThemePreference) => {
    document.documentElement.classList.add('theme-switching');
    setThemePref(pref);
    applyThemeToMeta(pref);
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching');
    });
    try {
      if (pref === 'system') {
        localStorage.removeItem('color-scheme');
      } else {
        localStorage.setItem('color-scheme', pref);
      }
    } catch {
      // ignore storage errors
    }
  };

  // Document title reflects current workspace view
  useEffect(() => {
    const titles: Record<TabId, string> = {
      train: 'Train | DeskMath Quant Studio',
      mistakes: 'Mistake Review & Coach | DeskMath Quant Studio',
      analytics: 'Speed Analytics | DeskMath Quant Studio',
    };
    document.title = titles[activeTab];
  }, [activeTab]);

  const refreshTelemetry = useCallback(async () => {
    try {
      const [ov, wk, st] = await Promise.all([
        api.getOverview(),
        api.getWeaknessProfile(),
        api.getSettings(),
      ]);
      setOverview(ov);
      setWeakness(wk);
      setSettings(st);
      setConfig((prev) => ({
        ...prev,
        targetMs: st.targetMs,
        speechRate: st.speechRate,
      }));
      setBackendError(null);
    } catch (err) {
      setBackendError(
        err instanceof Error ? err.message : 'Unable to reach API server',
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [ov, wk, st] = await Promise.all([
          api.getOverview(),
          api.getWeaknessProfile(),
          api.getSettings(),
        ]);
        if (!active) return;
        setOverview(ov);
        setWeakness(wk);
        setSettings(st);
        setConfig((prev) => ({
          ...prev,
          targetMs: st.targetMs,
          speechRate: st.speechRate,
        }));
        setBackendError(null);
      } catch (err) {
        if (!active) return;
        setBackendError(
          err instanceof Error ? err.message : 'Unable to reach API server',
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleTabKeyDown = (e: React.KeyboardEvent, current: TabId) => {
    const order: TabId[] = ['train', 'mistakes', 'analytics'];
    const idx = order.indexOf(current);
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % order.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + order.length) % order.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = order.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      const targetTab = order[nextIdx];
      setActiveTab(targetTab);
      tabRefs.current[targetTab]?.focus();
    }
  };

  const handleLaunchRecommendedDrill = (drill: RecommendedDrill) => {
    const base = structuredClone(DRILL_PRESETS.weakness_drill.config);
    setConfig((prev) => ({
      ...base,
      preset: drill.preset,
      mode: drill.mode ?? prev.mode,
      operations: drill.operations.length > 0 ? drill.operations : prev.operations,
      operationWeights: drill.operationWeights,
      targetMs: drill.targetMs ?? settings.targetMs,
      blindVoiceMode: prev.blindVoiceMode,
      speechRate: settings.speechRate,
    }));
    setActiveTab('train');
    announce(`Loaded recommended drill: ${drill.label}`);
  };

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    const nav = navigator as unknown as { install?: () => Promise<void> };
    const supportsWebInstall = typeof nav.install === 'function';
    try {
      if (supportsWebInstall && nav.install) {
        await nav.install();
        setCanInstall(false);
        announce('App installed or opened.');
      } else if (deferredPromptRef.current) {
        const promptEvent = deferredPromptRef.current;
        deferredPromptRef.current = null;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        announce(outcome === 'accepted' ? 'App installed.' : 'Installation canceled.');
        if (!deferredPromptRef.current) {
          setCanInstall(false);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        announce('Installation was canceled.');
      }
    } finally {
      setIsInstalling(false);
    }
  };

  const unreviewedCount = overview?.unreviewedIssuesCount ?? 0;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div role="status" aria-live="polite" className="visually-hidden">
        {liveMessage}
      </div>

      <header className="top-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              ∑
            </div>
            <div>
              <h1 className="brand-title">DeskMath Quant Studio</h1>
              <p className="brand-sub">Mixed Integer Speed &amp; Voice Mental Math</p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Workspace views"
            className="tablist"
          >
            <button
              ref={(el) => {
                tabRefs.current.train = el;
              }}
              type="button"
              role="tab"
              id="tab-train"
              aria-selected={activeTab === 'train'}
              tabIndex={activeTab === 'train' ? 0 : -1}
              className="tab-btn"
              onClick={() => setActiveTab('train')}
              onKeyDown={(e) => handleTabKeyDown(e, 'train')}
            >
              <Zap size={16} aria-hidden="true" /> Train
            </button>
            <button
              ref={(el) => {
                tabRefs.current.mistakes = el;
              }}
              type="button"
              role="tab"
              id="tab-mistakes"
              aria-selected={activeTab === 'mistakes'}
              tabIndex={activeTab === 'mistakes' ? 0 : -1}
              className="tab-btn"
              onClick={() => setActiveTab('mistakes')}
              onKeyDown={(e) => handleTabKeyDown(e, 'mistakes')}
            >
              <Brain size={16} aria-hidden="true" /> Mistakes &amp; Coach
              {unreviewedCount > 0 && (
                <span className="badge-count" aria-label={`${unreviewedCount} unreviewed issues`}>
                  {unreviewedCount}
                </span>
              )}
            </button>
            <button
              ref={(el) => {
                tabRefs.current.analytics = el;
              }}
              type="button"
              role="tab"
              id="tab-analytics"
              aria-selected={activeTab === 'analytics'}
              tabIndex={activeTab === 'analytics' ? 0 : -1}
              className="tab-btn"
              onClick={() => setActiveTab('analytics')}
              onKeyDown={(e) => handleTabKeyDown(e, 'analytics')}
            >
              <BarChart3 size={16} aria-hidden="true" /> Analytics
            </button>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-sm"
              hidden={!canInstall}
              aria-disabled={isInstalling ? 'true' : undefined}
              onClick={() => void handleInstallApp()}
            >
              <Download size={15} aria-hidden="true" /> Install App
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={15} aria-hidden="true" /> Settings
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="main-container" tabIndex={-1}>
        {backendError && (
          <div
            className="feedback-banner feedback-err"
            style={{ marginBlockEnd: '1rem', width: '100%' }}
            role="alert"
          >
            <span>
              Backend API warning ({backendError}). Ensure the API server is running so sessions persist.
            </span>
          </div>
        )}

        <div
          role="tabpanel"
          aria-labelledby="tab-train"
          hidden={activeTab !== 'train'}
        >
          {activeTab === 'train' && (
            <TrainArena
              config={config}
              onChangeConfig={setConfig}
              settings={settings}
              weaknessWeights={
                weakness?.weights ?? { add: 1, sub: 1, mul: 1.4, div: 1.3 }
              }
              onSessionSaved={() => {
                void refreshTelemetry();
              }}
              onOpenMistakes={(sid) => {
                setSessionFilter(sid ?? '');
                setActiveTab('mistakes');
              }}
              onAskCoachAboutAttempt={(attemptId) => {
                setCoachAttemptId(attemptId);
                setActiveTab('mistakes');
              }}
              announce={announce}
            />
          )}
        </div>

        <div
          role="tabpanel"
          aria-labelledby="tab-mistakes"
          hidden={activeTab !== 'mistakes'}
        >
          {activeTab === 'mistakes' && (
            <MistakesCoachView
              weakness={weakness}
              initialSessionFilter={sessionFilter}
              initialCoachAttemptId={coachAttemptId}
              onClearInitialCoachAttempt={() => setCoachAttemptId(null)}
              onLaunchRecommendedDrill={handleLaunchRecommendedDrill}
              onAttemptUpdated={() => void refreshTelemetry()}
            />
          )}
        </div>

        <div
          role="tabpanel"
          aria-labelledby="tab-analytics"
          hidden={activeTab !== 'analytics'}
        >
          {activeTab === 'analytics' && (
            <AnalyticsView
              overview={overview}
              onInspectSession={(sid) => {
                setSessionFilter(sid);
                setActiveTab('mistakes');
              }}
            />
          )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsUpdated={(next) => {
          setSettings(next);
          setConfig((prev) => ({
            ...prev,
            targetMs: next.targetMs,
            speechRate: next.speechRate,
          }));
          announce('Settings saved.');
        }}
        themePref={themePref}
        systemDark={systemDark}
        onThemeChange={handleThemeChange}
        onDataReset={() => {
          void refreshTelemetry();
          announce('Training data reset.');
        }}
      />
    </div>
  );
}

export default App;
