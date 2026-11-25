"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Download,
  ListChecks,
  LogIn,
  LogOut,
  MessageSquare,
  Settings,
  Zap,
} from "lucide-react";
import {
  createDefaultDrillConfig,
  DRILL_PRESETS,
  type DrillConfig,
  type OverviewStats,
  type PublicAuthConfig,
  type PublicSettings,
  type RecommendedDrill,
  type WeaknessProfile,
} from "@/lib/math";
import { api, setAuthTokenGetter } from "@/lib/client/api";
import {
  getFirebaseClientAuth,
  onAuthStateChanged,
  signInWithGoogleSmart,
  signOut,
  type User,
} from "@/lib/client/firebaseAuth";
import { AnalyticsWorkbench } from "./AnalyticsWorkbench";
import { CoachWorkbench } from "./CoachWorkbench";
import { MistakesWorkbench } from "./MistakesWorkbench";
import { SettingsModal, type ThemePreference } from "./SettingsModal";
import { TrainArena } from "./TrainArena";

type NavViewId = "train" | "mistakes" | "coach" | "analytics";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readInitialTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem("color-scheme");
    if (val === "light" || val === "dark") return val;
  } catch {
    // ignore storage error
  }
  return "system";
}

function applyThemeToMeta(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", pref === "system" ? "light dark" : pref);
  }
}

export function DeskMathStudio() {
  const [activeView, setActiveView] = useState<NavViewId>("train");
  const [config, setConfig] = useState<DrillConfig>(createDefaultDrillConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [authConfig, setAuthConfig] = useState<PublicAuthConfig | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [canInstall, setCanInstall] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    typeof (Navigator.prototype as unknown as { install?: () => Promise<void> })
      .install === "function",
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  const [themePref, setThemePref] = useState<ThemePreference>(readInitialTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );

  const [settings, setSettings] = useState<PublicSettings>({
    targetMs: 3500,
    speechRate: 1.25,
    voiceName: "",
    soundEnabled: true,
    cloudTtsEnabled: false,
    aiProvider: "builtin",
    geminiPrimaryModel: "gemini-2.5-flash",
    geminiLiteModel: "gemini-2.5-flash-lite",
    hasApiKey: false,
    maskedApiKey: null,
    storageBackend: "local",
  });
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [weakness, setWeakness] = useState<WeaknessProfile | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [pendingCoachRequest, setPendingCoachRequest] = useState<{
    attemptId: string | null;
    question: string;
  } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");

  const announce = useCallback((msg: string) => {
    setLiveMessage("");
    requestAnimationFrame(() => setLiveMessage(msg));
  }, []);

  useEffect(() => {
    applyThemeToMeta(themePref);
  }, [themePref]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMqChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onMqChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "color-scheme") {
        const next: ThemePreference =
          e.newValue === "light" || e.newValue === "dark"
            ? e.newValue
            : "system";
        setThemePref(next);
        applyThemeToMeta(next);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const handleThemeChange = (pref: ThemePreference) => {
    document.documentElement.classList.add("theme-switching");
    setThemePref(pref);
    applyThemeToMeta(pref);
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("theme-switching");
    });
    try {
      if (pref === "system") {
        localStorage.removeItem("color-scheme");
      } else {
        localStorage.setItem("color-scheme", pref);
      }
    } catch {
      // ignore storage error
    }
  };

  useEffect(() => {
    const titles: Record<NavViewId, string> = {
      train: "Train | DeskMath Quant Studio",
      mistakes: "Mistakes Review | DeskMath Quant Studio",
      coach: "Gemini Quant Coach | DeskMath Quant Studio",
      analytics: "Speed Analytics | DeskMath Quant Studio",
    };
    document.title = titles[activeView];
  }, [activeView]);

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
        err instanceof Error ? err.message : "Unable to load telemetry",
      );
    }
  }, []);

  // Bootstrap Auth Config + Telemetry
  useEffect(() => {
    let active = true;
    let unsubscribeAuth: (() => void) | null = null;

    (async () => {
      try {
        const cfg = await api.getAuthConfig();
        if (!active) return;
        setAuthConfig(cfg);

        if (!cfg.authRequired) {
          setAuthLoading(false);
          await refreshTelemetry();
          return;
        }

        const auth = getFirebaseClientAuth(cfg);
        if (!auth) {
          setAuthError(
            "AUTH_REQUIRED=true is enabled, but Firebase client variables are missing.",
          );
          setAuthLoading(false);
          return;
        }

        unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
          if (!active) return;
          setAuthUser(user);
          if (user) {
            setAuthTokenGetter(() => user.getIdToken());
            setAuthLoading(false);
            await refreshTelemetry();
          } else {
            setAuthTokenGetter(null);
            setAuthLoading(false);
          }
        });
      } catch (err) {
        if (!active) return;
        setAuthLoading(false);
        setBackendError(
          err instanceof Error ? err.message : "Failed to initialize app",
        );
      }
    })();

    return () => {
      active = false;
      unsubscribeAuth?.();
    };
  }, [refreshTelemetry]);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    const nav = navigator as unknown as { install?: () => Promise<void> };
    const supportsWebInstall = typeof nav.install === "function";
    try {
      if (supportsWebInstall && nav.install) {
        await nav.install();
        setCanInstall(false);
        announce("App installed or opened.");
      } else if (deferredPromptRef.current) {
        const promptEvent = deferredPromptRef.current;
        deferredPromptRef.current = null;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        announce(
          outcome === "accepted" ? "App installed." : "Installation canceled.",
        );
        if (!deferredPromptRef.current) {
          setCanInstall(false);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        announce("Installation was canceled.");
      }
    } finally {
      setIsInstalling(false);
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
    setActiveView("train");
    announce(`Loaded recommended drill: ${drill.label}`);
  };

  const unreviewedCount = overview?.unreviewedIssuesCount ?? 0;

  if (authConfig?.authRequired && !authLoading && !authUser) {
    return (
      <div
        className="app-frame"
        style={{ display: "grid", placeItems: "center", padding: "1.5rem" }}
      >
        <section
          className="panel stack-lg"
          style={{ maxInlineSize: "420px", textAlign: "center" }}
        >
          <div className="brand" style={{ justifyContent: "center" }}>
            <div className="brand-mark" aria-hidden="true">
              ∑
            </div>
            <div style={{ textAlign: "start" }}>
              <h1 className="brand-title">DeskMath Quant Studio</h1>
              <p className="brand-sub">Google Cloud Private Instance</p>
            </div>
          </div>
          <p className="section-sub">
            Sign in with your authorized Google account to access your Firestore
            speed history and Gemini Quant Coach.
          </p>
          {authError && (
            <div className="feedback-banner feedback-err">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{authError}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              setAuthError(null);
              try {
                const auth = getFirebaseClientAuth(authConfig);
                if (auth) await signInWithGoogleSmart(auth);
              } catch (err) {
                setAuthError(
                  err instanceof Error ? err.message : "Google Sign-In failed",
                );
              }
            }}
          >
            <LogIn size={16} aria-hidden="true" /> Sign in with Google
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div role="status" aria-live="polite" className="visually-hidden">
        {liveMessage}
      </div>

      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              ∑
            </div>
            <div>
              <h1 className="brand-title">DeskMath Quant Studio</h1>
              <p className="brand-sub">
                Mixed Integer Speed · Voice &amp; Gemini Coach
              </p>
            </div>
          </div>

          <div className="toolbar">
            <button
              type="button"
              className="btn btn-sm"
              hidden={!canInstall}
              aria-disabled={isInstalling ? "true" : undefined}
              onClick={() => void handleInstallApp()}
            >
              <Download size={15} aria-hidden="true" /> Install App
            </button>

            {authConfig?.authRequired && authUser && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const auth = getFirebaseClientAuth(authConfig);
                  if (auth) await signOut(auth);
                }}
              >
                <LogOut size={15} aria-hidden="true" /> Sign out
              </button>
            )}

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

      {/* Single semantic <nav className="app-nav"> — bottom 4-col bar on iPhone, sticky 232px rail on PC */}
      <nav className="app-nav" aria-label="Primary">
        <button
          type="button"
          className="nav-item"
          aria-current={activeView === "train" ? "page" : undefined}
          onClick={() => setActiveView("train")}
        >
          <Zap size={18} aria-hidden="true" />
          <span>Train</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeView === "mistakes" ? "page" : undefined}
          onClick={() => setActiveView("mistakes")}
        >
          <ListChecks size={18} aria-hidden="true" />
          <span>Mistakes</span>
          {unreviewedCount > 0 && (
            <span
              className="nav-badge"
              aria-label={`${unreviewedCount} unreviewed issues`}
            >
              {unreviewedCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeView === "coach" ? "page" : undefined}
          onClick={() => setActiveView("coach")}
        >
          <MessageSquare size={18} aria-hidden="true" />
          <span>Coach</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeView === "analytics" ? "page" : undefined}
          onClick={() => setActiveView("analytics")}
        >
          <BarChart3 size={18} aria-hidden="true" />
          <span>Analytics</span>
        </button>
      </nav>

      <main id="main-content" className="app-main" tabIndex={-1}>
        {backendError && (
          <div
            className="feedback-banner feedback-err"
            style={{ marginBlockEnd: "1rem", inlineSize: "100%" }}
            role="alert"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{backendError}</span>
          </div>
        )}

        {activeView === "train" && (
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
              setSessionFilter(sid ?? "");
              setActiveView("mistakes");
            }}
            onAskCoachAboutAttempt={(attemptId) => {
              setPendingCoachRequest({
                attemptId,
                question:
                  "Analyze this mistake, explain why it happened, and give me the fastest mental trick for it.",
              });
              setActiveView("coach");
            }}
            announce={announce}
          />
        )}

        {activeView === "mistakes" && (
          <MistakesWorkbench
            sessionFilter={sessionFilter}
            onClearSessionFilter={() => setSessionFilter("")}
            onAskCoachAboutAttempt={(attemptId, customPrompt) => {
              setPendingCoachRequest({
                attemptId,
                question:
                  customPrompt ??
                  "Analyze this mistake and give me the fastest mental shortcut.",
              });
              setActiveView("coach");
            }}
            onAttemptUpdated={() => void refreshTelemetry()}
          />
        )}

        {activeView === "coach" && (
          <CoachWorkbench
            weakness={weakness}
            settings={settings}
            pendingCoachRequest={pendingCoachRequest}
            onConsumePendingRequest={() => setPendingCoachRequest(null)}
            onLaunchRecommendedDrill={handleLaunchRecommendedDrill}
          />
        )}

        {activeView === "analytics" && (
          <AnalyticsWorkbench
            overview={overview}
            onInspectSession={(sid) => {
              setSessionFilter(sid);
              setActiveView("mistakes");
            }}
          />
        )}
      </main>

      <SettingsModal
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
          announce("Settings saved.");
        }}
        themePref={themePref}
        systemDark={systemDark}
        onThemeChange={handleThemeChange}
        onDataReset={() => {
          void refreshTelemetry();
          announce("Training data reset.");
        }}
      />
    </div>
  );
}
