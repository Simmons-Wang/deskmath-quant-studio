import type {
  AttemptRecord,
  CoachMessageRecord,
  CoachProvider,
  Operation,
  OverviewStats,
  PublicAuthConfig,
  PublicSettings,
  SaveSessionInput,
  SessionRecord,
  WeaknessProfile,
} from "@/lib/math";

let idTokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: (() => Promise<string | null>) | null) {
  idTokenGetter = getter;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!idTokenGetter) return {};
  const token = await idTokenGetter();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
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
  getAuthConfig: () => requestJson<PublicAuthConfig>("/api/auth/config"),
  getOverview: () => requestJson<OverviewStats>("/api/overview"),
  getWeaknessProfile: () => requestJson<WeaknessProfile>("/api/weakness-profile"),
  saveSession: (payload: SaveSessionInput) =>
    requestJson<{ session: SessionRecord; attempts: AttemptRecord[] }>(
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  getAttempts: (params: {
    issueFilter?: "all" | "issues" | "wrong" | "skipped_timeout" | "slow";
    op?: Operation | "all";
    mode?: "all" | "visual" | "voice";
    sessionId?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.issueFilter) q.set("issueFilter", params.issueFilter);
    if (params.op) q.set("op", params.op);
    if (params.mode) q.set("mode", params.mode);
    if (params.sessionId) q.set("sessionId", params.sessionId);
    if (params.limit) q.set("limit", String(params.limit));
    return requestJson<{ attempts: AttemptRecord[] }>(`/api/attempts?${q.toString()}`);
  },
  updateAttempt: (id: string, patch: { reviewed?: boolean; note?: string | null }) =>
    requestJson<{ attempt: AttemptRecord }>(
      `/api/attempts/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    ),
  getCoachMessages: () =>
    requestJson<{ messages: CoachMessageRecord[] }>("/api/coach/messages"),
  clearCoachMessages: () =>
    requestJson<{ ok: boolean }>("/api/coach/messages", { method: "DELETE" }),
  askCoach: (body: { question: string; focusAttemptId?: string | null }) =>
    requestJson<{
      userMessage: CoachMessageRecord;
      assistantMessage: CoachMessageRecord;
    }>("/api/coach/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSettings: () => requestJson<PublicSettings>("/api/settings"),
  updateSettings: (patch: {
    targetMs?: number;
    speechRate?: number;
    voiceName?: string;
    soundEnabled?: boolean;
    cloudTtsEnabled?: boolean;
    aiProvider?: CoachProvider;
    geminiPrimaryModel?: string;
    geminiLiteModel?: string;
    geminiApiKey?: string | null;
  }) =>
    requestJson<PublicSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  testGeminiConnection: (body: { model: string; apiKey?: string }) =>
    requestJson<{ ok: boolean; message: string }>("/api/settings/test-ai", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  synthesizeCloudTts: (body: { text: string; rate: number }) =>
    requestJson<{ available: boolean; mediaUrl?: string }>("/api/tts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetTrainingData: () =>
    requestJson<{ ok: boolean }>("/api/data", { method: "DELETE" }),
};
