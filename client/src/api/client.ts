import type {
  AttemptStatus,
  DrillConfig,
  ErrorCategory,
  Operation,
  TrainingMode,
} from '../../../shared/math.js';

export interface SessionRecord {
  id: string;
  createdAt: string;
  mode: TrainingMode;
  preset: string;
  format: string;
  submissionMode: string;
  durationLimitSec: number | null;
  questionLimit: number | null;
  targetMs: number;
  operations: Operation[];
  allowNegative: boolean;
  totalAttempts: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  timeoutCount: number;
  slowCorrectCount: number;
  elapsedMs: number;
  ppm: number;
  meanMs: number;
  medianMs: number;
  p90Ms: number;
}

export interface AttemptRecord {
  id: string;
  sessionId: string;
  createdAt: string;
  seq: number;
  op: Operation;
  a: number;
  b: number;
  correctAnswer: number;
  userAnswer: number | null;
  rawInput: string | null;
  status: AttemptStatus;
  mode: TrainingMode;
  reactionMs: number;
  processingMs: number | null;
  isSlow: boolean;
  errorCategory: ErrorCategory;
  patternTag: string;
  trickSummary: string;
  reviewed: boolean;
  note: string | null;
}

export interface OpStats {
  op: Operation;
  total: number;
  correct: number;
  wrong: number;
  skippedOrTimeout: number;
  slowCorrect: number;
  accuracyPct: number;
  meanMs: number;
  p90Ms: number;
}

export interface ModeStats {
  bucket: 'visual' | 'voice';
  total: number;
  correct: number;
  accuracyPct: number;
  meanMs: number;
  meanProcessingMs: number | null;
}

export interface OverviewStats {
  totalSessions: number;
  totalAttempts: number;
  overallAccuracyPct: number;
  overallMeanMs: number;
  bestPpm: number;
  unreviewedIssuesCount: number;
  opStats: OpStats[];
  modeStats: ModeStats[];
  errorBreakdown: Array<{ category: ErrorCategory; count: number }>;
  weakPatterns: Array<{
    patternTag: string;
    op: Operation;
    total: number;
    issueCount: number;
    meanMs: number;
  }>;
  recentSessions: SessionRecord[];
}

export interface WeaknessProfile {
  weights: Record<Operation, number>;
  priorityOps: Operation[];
  headline: string;
  bullets: string[];
  recommendedConfig: DrillConfig;
}

export interface RecommendedDrill {
  label: string;
  preset: 'weakness_drill' | 'custom';
  operations: Operation[];
  mode?: TrainingMode;
  operationWeights?: Partial<Record<Operation, number>>;
  targetMs?: number;
}

export interface CoachMessageRecord {
  id: string;
  createdAt: string;
  role: 'user' | 'assistant';
  content: string;
  focusAttemptId: string | null;
  provider: 'builtin' | 'openai' | 'gemini';
  recommendedDrill: RecommendedDrill | null;
}

export interface PublicSettings {
  targetMs: number;
  speechRate: number;
  voiceName: string;
  soundEnabled: boolean;
  aiProvider: 'builtin' | 'openai' | 'gemini';
  aiModel: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
}

export interface SaveSessionPayload {
  mode: TrainingMode;
  preset: string;
  format: string;
  submissionMode: string;
  durationLimitSec: number | null;
  questionLimit: number | null;
  targetMs: number;
  operations: Operation[];
  allowNegative: boolean;
  elapsedMs: number;
  attempts: Array<{
    seq: number;
    op: Operation;
    a: number;
    b: number;
    userAnswer: number | null;
    rawInput?: string;
    status: AttemptStatus;
    mode: TrainingMode;
    reactionMs: number;
    processingMs?: number | null;
  }>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  getOverview: () => requestJson<OverviewStats>('/api/overview'),
  getWeaknessProfile: () => requestJson<WeaknessProfile>('/api/weakness-profile'),
  saveSession: (payload: SaveSessionPayload) =>
    requestJson<{ session: SessionRecord; attempts: AttemptRecord[] }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAttempts: (params: {
    issueFilter?: 'all' | 'issues' | 'wrong' | 'skipped_timeout' | 'slow';
    op?: Operation | 'all';
    mode?: 'all' | 'visual' | 'voice';
    sessionId?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.issueFilter) q.set('issueFilter', params.issueFilter);
    if (params.op) q.set('op', params.op);
    if (params.mode) q.set('mode', params.mode);
    if (params.sessionId) q.set('sessionId', params.sessionId);
    if (params.limit) q.set('limit', String(params.limit));
    return requestJson<{ attempts: AttemptRecord[] }>(`/api/attempts?${q.toString()}`);
  },
  updateAttempt: (id: string, patch: { reviewed?: boolean; note?: string | null }) =>
    requestJson<{ attempt: AttemptRecord }>(`/api/attempts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getCoachMessages: () => requestJson<{ messages: CoachMessageRecord[] }>('/api/coach/messages'),
  clearCoachMessages: () =>
    requestJson<{ ok: boolean }>('/api/coach/messages', { method: 'DELETE' }),
  askCoach: (body: { question: string; focusAttemptId?: string | null }) =>
    requestJson<{ userMessage: CoachMessageRecord; assistantMessage: CoachMessageRecord }>(
      '/api/coach/ask',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  getSettings: () => requestJson<PublicSettings>('/api/settings'),
  updateSettings: (patch: {
    targetMs?: number;
    speechRate?: number;
    voiceName?: string;
    soundEnabled?: boolean;
    aiProvider?: 'builtin' | 'openai' | 'gemini';
    aiModel?: string;
    aiApiKey?: string | null;
  }) =>
    requestJson<PublicSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  testAiConnection: (body: {
    provider: 'openai' | 'gemini';
    model: string;
    apiKey?: string;
  }) =>
    requestJson<{ ok: boolean; message: string }>('/api/settings/test-ai', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetTrainingData: () => requestJson<{ ok: boolean }>('/api/data', { method: 'DELETE' }),
};
