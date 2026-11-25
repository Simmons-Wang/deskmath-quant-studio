import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import {
  analyzeProblemTrick,
  classifyAttemptError,
  classifyPatternTag,
  computeExpectedAnswer,
  DRILL_PRESETS,
  type AttemptRecord,
  type AttemptStatus,
  type CoachMessageRecord,
  type CoachProvider,
  type DrillConfig,
  type ErrorCategory,
  type ModeStats,
  type OpStats,
  type Operation,
  type OverviewStats,
  type PublicSettings,
  type SaveSessionInput,
  type SessionRecord,
  type WeaknessProfile,
} from "@/lib/math";

interface StoredSettingsRaw {
  targetMs: number;
  speechRate: number;
  voiceName: string;
  soundEnabled: boolean;
  cloudTtsEnabled: boolean;
  aiProvider: CoachProvider;
  geminiPrimaryModel: string;
  geminiLiteModel: string;
  geminiApiKey: string;
}

interface LocalStoreFile {
  sessions: SessionRecord[];
  attempts: AttemptRecord[];
  coachMessages: CoachMessageRecord[];
  settings: StoredSettingsRaw;
}

export interface AttemptQueryFilters {
  issueFilter?: "all" | "issues" | "wrong" | "skipped_timeout" | "slow";
  op?: Operation | "all";
  mode?: "all" | "visual" | "voice";
  sessionId?: string;
  limit?: number;
}

export interface SettingsPatch {
  targetMs?: number;
  speechRate?: number;
  voiceName?: string;
  soundEnabled?: boolean;
  cloudTtsEnabled?: boolean;
  aiProvider?: CoachProvider;
  geminiPrimaryModel?: string;
  geminiLiteModel?: string;
  geminiApiKey?: string | null;
}

export interface MediaPayload {
  buffer: Buffer;
  contentType: string;
}

export interface DeskMathStore {
  readonly backend: "local" | "gcp";
  saveSessionWithAttempts(
    input: SaveSessionInput,
  ): Promise<{ session: SessionRecord; attempts: AttemptRecord[] }>;
  getSessions(limit?: number): Promise<SessionRecord[]>;
  getSessionDetail(
    id: string,
  ): Promise<{ session: SessionRecord; attempts: AttemptRecord[] } | null>;
  getAttemptById(id: string): Promise<AttemptRecord | null>;
  getAttempts(filters: AttemptQueryFilters): Promise<AttemptRecord[]>;
  updateAttempt(
    id: string,
    patch: { reviewed?: boolean; note?: string | null },
  ): Promise<AttemptRecord | null>;
  getOverviewStats(): Promise<OverviewStats>;
  getWeaknessProfile(): Promise<WeaknessProfile>;
  getCoachMessages(limit?: number): Promise<CoachMessageRecord[]>;
  addCoachMessage(
    msg: Omit<CoachMessageRecord, "id" | "createdAt">,
  ): Promise<CoachMessageRecord>;
  clearCoachMessages(): Promise<void>;
  getSettings(): Promise<PublicSettings>;
  getEffectiveGeminiConfig(): Promise<{
    provider: CoachProvider;
    primaryModel: string;
    liteModel: string;
    apiKey: string;
  }>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>;
  exportAllData(): Promise<{
    exportedAt: string;
    settings: PublicSettings;
    overview: OverviewStats;
    sessions: SessionRecord[];
    attempts: AttemptRecord[];
  }>;
  resetTrainingData(): Promise<void>;
  readMedia(relativePath: string): Promise<MediaPayload | null>;
  writeMedia(
    relativePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void>;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function sanitizeMediaPath(raw: string): string {
  const normalized = path.posix
    .normalize(raw.replace(/\\/g, "/"))
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid media path");
  }
  return normalized;
}

function defaultRawSettings(): StoredSettingsRaw {
  const envKey = (process.env.GEMINI_API_KEY ?? "").trim();
  return {
    targetMs: 3500,
    speechRate: 1.25,
    voiceName: "",
    soundEnabled: true,
    cloudTtsEnabled: process.env.GCP_TTS_ENABLED === "true",
    aiProvider: envKey ? "gemini" : "builtin",
    geminiPrimaryModel: process.env.GEMINI_PRIMARY_MODEL ?? "gemini-2.5-flash",
    geminiLiteModel: process.env.GEMINI_LITE_MODEL ?? "gemini-2.5-flash-lite",
    geminiApiKey: "",
  };
}

function toPublicSettings(
  raw: StoredSettingsRaw,
  backend: "local" | "gcp",
): PublicSettings {
  const effectiveKey = raw.geminiApiKey.trim() || (process.env.GEMINI_API_KEY ?? "").trim();
  return {
    targetMs: raw.targetMs,
    speechRate: raw.speechRate,
    voiceName: raw.voiceName,
    soundEnabled: raw.soundEnabled,
    cloudTtsEnabled: raw.cloudTtsEnabled,
    aiProvider: raw.aiProvider,
    geminiPrimaryModel: raw.geminiPrimaryModel,
    geminiLiteModel: raw.geminiLiteModel,
    hasApiKey: effectiveKey.length > 0,
    maskedApiKey: effectiveKey.length > 0 ? maskKey(effectiveKey) : null,
    storageBackend: backend,
  };
}

function applySettingsPatch(
  prev: StoredSettingsRaw,
  patch: SettingsPatch,
): StoredSettingsRaw {
  const next = { ...prev };
  if (patch.targetMs !== undefined) {
    next.targetMs = Math.min(15000, Math.max(800, Math.round(patch.targetMs)));
  }
  if (patch.speechRate !== undefined) {
    next.speechRate = Math.min(2.2, Math.max(0.7, Number(patch.speechRate)));
  }
  if (patch.voiceName !== undefined) {
    next.voiceName = patch.voiceName;
  }
  if (patch.soundEnabled !== undefined) {
    next.soundEnabled = patch.soundEnabled;
  }
  if (patch.cloudTtsEnabled !== undefined) {
    next.cloudTtsEnabled = patch.cloudTtsEnabled;
  }
  if (patch.aiProvider !== undefined) {
    next.aiProvider = patch.aiProvider;
  }
  if (patch.geminiPrimaryModel !== undefined && patch.geminiPrimaryModel.trim()) {
    next.geminiPrimaryModel = patch.geminiPrimaryModel.trim();
  }
  if (patch.geminiLiteModel !== undefined && patch.geminiLiteModel.trim()) {
    next.geminiLiteModel = patch.geminiLiteModel.trim();
  }
  if (patch.geminiApiKey !== undefined) {
    next.geminiApiKey = patch.geminiApiKey === null ? "" : patch.geminiApiKey.trim();
  }
  return next;
}

function buildSessionAndAttempts(input: SaveSessionInput): {
  session: SessionRecord;
  attempts: AttemptRecord[];
} {
  const sessionId = randomUUID();
  const createdAt = new Date().toISOString();

  const attempts: AttemptRecord[] = input.attempts.map((att, index) => {
    const correctAnswer = computeExpectedAnswer(att.op, att.a, att.b);
    const status: AttemptStatus =
      att.status === "correct" && att.userAnswer === correctAnswer
        ? "correct"
        : att.status === "skipped" || att.status === "timeout"
          ? att.status
          : att.userAnswer === correctAnswer
            ? "correct"
            : "wrong";

    const reactionMs = Math.max(50, Math.round(att.reactionMs));
    const processingMs =
      att.processingMs !== undefined && att.processingMs !== null
        ? Math.max(50, Math.round(att.processingMs))
        : null;
    const isSlow = status === "correct" && reactionMs > input.targetMs;
    const errorCategory = classifyAttemptError({
      status,
      correctAnswer,
      userAnswer: att.userAnswer,
      reactionMs,
      targetMs: input.targetMs,
    });
    const patternTag = classifyPatternTag(att.op, att.a, att.b);
    const trick = analyzeProblemTrick(att.op, att.a, att.b, correctAnswer);

    return {
      id: randomUUID(),
      sessionId,
      createdAt,
      seq: att.seq ?? index + 1,
      op: att.op,
      a: att.a,
      b: att.b,
      correctAnswer,
      userAnswer: att.userAnswer,
      rawInput: att.rawInput ?? null,
      status,
      mode: att.mode,
      reactionMs,
      processingMs,
      isSlow,
      errorCategory,
      patternTag,
      trickSummary: trick.summary,
      reviewed: false,
      note: null,
    };
  });

  const totalAttempts = attempts.length;
  const correctCount = attempts.filter((x) => x.status === "correct").length;
  const wrongCount = attempts.filter((x) => x.status === "wrong").length;
  const skippedCount = attempts.filter((x) => x.status === "skipped").length;
  const timeoutCount = attempts.filter((x) => x.status === "timeout").length;
  const slowCorrectCount = attempts.filter((x) => x.isSlow).length;

  const elapsedMs = Math.max(1000, Math.round(input.elapsedMs));
  const ppm = Number(((correctCount / elapsedMs) * 60_000).toFixed(2));
  const latencies = attempts.map((x) => x.reactionMs).sort((x, y) => x - y);
  const meanMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
      : 0;

  const session: SessionRecord = {
    id: sessionId,
    createdAt,
    mode: input.mode,
    preset: input.preset,
    format: input.format,
    submissionMode: input.submissionMode,
    durationLimitSec: input.durationLimitSec ?? null,
    questionLimit: input.questionLimit ?? null,
    targetMs: input.targetMs,
    operations: input.operations,
    allowNegative: input.allowNegative,
    totalAttempts,
    correctCount,
    wrongCount,
    skippedCount,
    timeoutCount,
    slowCorrectCount,
    elapsedMs,
    ppm,
    meanMs,
    medianMs: percentile(latencies, 50),
    p90Ms: percentile(latencies, 90),
  };

  return { session, attempts };
}

function filterAttemptList(
  all: AttemptRecord[],
  filters: AttemptQueryFilters,
): AttemptRecord[] {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 150));
  return all
    .filter((a) => {
      if (filters.issueFilter === "issues" && a.status === "correct" && !a.isSlow) {
        return false;
      }
      if (filters.issueFilter === "wrong" && a.status !== "wrong") return false;
      if (
        filters.issueFilter === "skipped_timeout" &&
        a.status !== "skipped" &&
        a.status !== "timeout"
      ) {
        return false;
      }
      if (filters.issueFilter === "slow" && !a.isSlow) return false;
      if (filters.op && filters.op !== "all" && a.op !== filters.op) return false;
      if (filters.mode === "visual" && a.mode !== "visual") return false;
      if (filters.mode === "voice" && a.mode === "visual") return false;
      if (filters.sessionId && a.sessionId !== filters.sessionId) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq)
    .slice(0, limit);
}

function computeOverview(
  sessions: SessionRecord[],
  attempts: AttemptRecord[],
): OverviewStats {
  const sortedSessions = [...sessions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const recentAttempts = [...attempts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2000);

  const totalAttempts = recentAttempts.length;
  const correctTotal = recentAttempts.filter((a) => a.status === "correct").length;
  const overallAccuracyPct =
    totalAttempts > 0 ? Number(((correctTotal / totalAttempts) * 100).toFixed(1)) : 0;
  const overallMeanMs =
    totalAttempts > 0
      ? Math.round(
          recentAttempts.reduce((sum, a) => sum + a.reactionMs, 0) / totalAttempts,
        )
      : 0;
  const bestPpm = sortedSessions.reduce((max, s) => Math.max(max, s.ppm), 0);
  const unreviewedIssuesCount = recentAttempts.filter(
    (a) => (a.status !== "correct" || a.isSlow) && !a.reviewed,
  ).length;

  const ops: Operation[] = ["add", "sub", "mul", "div"];
  const opStats: OpStats[] = ops.map((op) => {
    const list = recentAttempts.filter((a) => a.op === op);
    const correct = list.filter((a) => a.status === "correct").length;
    const wrong = list.filter((a) => a.status === "wrong").length;
    const skippedOrTimeout = list.filter(
      (a) => a.status === "skipped" || a.status === "timeout",
    ).length;
    const slowCorrect = list.filter((a) => a.isSlow).length;
    const latencies = list.map((a) => a.reactionMs).sort((x, y) => x - y);
    const meanMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
        : 0;
    return {
      op,
      total: list.length,
      correct,
      wrong,
      skippedOrTimeout,
      slowCorrect,
      accuracyPct: list.length > 0 ? Number(((correct / list.length) * 100).toFixed(1)) : 0,
      meanMs,
      p90Ms: percentile(latencies, 90),
    };
  });

  const modeBuckets: Array<"visual" | "voice"> = ["visual", "voice"];
  const modeStats: ModeStats[] = modeBuckets.map((bucket) => {
    const list = recentAttempts.filter((a) =>
      bucket === "visual" ? a.mode === "visual" : a.mode !== "visual",
    );
    const correct = list.filter((a) => a.status === "correct").length;
    const meanMs =
      list.length > 0
        ? Math.round(list.reduce((s, a) => s + a.reactionMs, 0) / list.length)
        : 0;
    const proc = list
      .map((a) => a.processingMs)
      .filter((x): x is number => x !== null);
    const meanProcessingMs =
      proc.length > 0 ? Math.round(proc.reduce((s, v) => s + v, 0) / proc.length) : null;
    return {
      bucket,
      total: list.length,
      correct,
      accuracyPct: list.length > 0 ? Number(((correct / list.length) * 100).toFixed(1)) : 0,
      meanMs,
      meanProcessingMs,
    };
  });

  const errorMap = new Map<ErrorCategory, number>();
  for (const a of recentAttempts) {
    if (a.errorCategory !== "none") {
      errorMap.set(a.errorCategory, (errorMap.get(a.errorCategory) ?? 0) + 1);
    }
  }
  const errorBreakdown = Array.from(errorMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const patternMap = new Map<
    string,
    { patternTag: string; op: Operation; total: number; issueCount: number; latencySum: number }
  >();
  for (const a of recentAttempts) {
    const entry = patternMap.get(a.patternTag) ?? {
      patternTag: a.patternTag,
      op: a.op,
      total: 0,
      issueCount: 0,
      latencySum: 0,
    };
    entry.total += 1;
    if (a.status !== "correct" || a.isSlow) entry.issueCount += 1;
    entry.latencySum += a.reactionMs;
    patternMap.set(a.patternTag, entry);
  }

  const weakPatterns = Array.from(patternMap.values())
    .map((p) => ({
      patternTag: p.patternTag,
      op: p.op,
      total: p.total,
      issueCount: p.issueCount,
      meanMs: Math.round(p.latencySum / p.total),
    }))
    .sort(
      (a, b) =>
        b.issueCount / b.total - a.issueCount / a.total || b.meanMs - a.meanMs,
    )
    .slice(0, 6);

  return {
    totalSessions: sortedSessions.length,
    totalAttempts,
    overallAccuracyPct,
    overallMeanMs,
    bestPpm,
    unreviewedIssuesCount,
    opStats,
    modeStats,
    errorBreakdown,
    weakPatterns,
    recentSessions: sortedSessions.slice(0, 12),
  };
}

function computeWeakness(
  overview: OverviewStats,
  settings: PublicSettings,
): WeaknessProfile {
  const targetMs = settings.targetMs;
  const weights: Record<Operation, number> = {
    add: 1,
    sub: 1,
    mul: 1.4,
    div: 1.3,
  };

  const opScores = overview.opStats.map((stat) => {
    if (stat.total === 0) {
      return { op: stat.op, score: stat.op === "mul" || stat.op === "div" ? 1.4 : 1 };
    }
    const errRate = (stat.wrong + stat.skippedOrTimeout) / stat.total;
    const slowRatio = Math.max(0, stat.meanMs / Math.max(1000, targetMs) - 0.65);
    const score = 1 + errRate * 4.5 + slowRatio * 1.6;
    weights[stat.op] = Number(Math.min(4.5, Math.max(0.6, score)).toFixed(2));
    return { op: stat.op, score };
  });

  const priorityOps = [...opScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.op);

  const bullets: string[] = [];
  if (overview.totalAttempts === 0) {
    bullets.push(
      "No drill telemetry logged yet — starting with balanced 3-digit addition/subtraction and 2×2 multiplication.",
    );
    bullets.push(
      "Keep target reaction speed under 3.5s per problem; compare Visual and Voice modes to benchmark auditory latency.",
    );
  } else {
    const slowest = [...overview.opStats]
      .filter((s) => s.total > 0)
      .sort((a, b) => b.meanMs - a.meanMs)[0];
    if (slowest) {
      bullets.push(
        `Slowest operation: ${slowest.op.toUpperCase()} averaging ${(slowest.meanMs / 1000).toFixed(2)}s (${slowest.accuracyPct}% accuracy across ${slowest.total} problems).`,
      );
    }

    const topError = overview.errorBreakdown[0];
    if (topError) {
      bullets.push(
        `Most frequent breakdown: ${topError.category.replace(/_/g, " ")} (${topError.count} occurrences).`,
      );
    }

    const visual = overview.modeStats.find((m) => m.bucket === "visual");
    const voice = overview.modeStats.find((m) => m.bucket === "voice");
    if (visual && voice && visual.total > 0 && voice.total > 0) {
      const delta = voice.meanMs - visual.meanMs;
      bullets.push(
        `Voice vs Visual latency delta: ${delta >= 0 ? "+" : ""}${(delta / 1000).toFixed(2)}s (${(voice.meanMs / 1000).toFixed(2)}s voice vs ${(visual.meanMs / 1000).toFixed(2)}s visual).`,
      );
    }
  }

  const basePreset = structuredClone(DRILL_PRESETS.weakness_drill.config);
  const recommendedConfig: DrillConfig = {
    ...basePreset,
    mode: "visual",
    blindVoiceMode: true,
    speechRate: settings.speechRate,
    targetMs,
    operationWeights: weights,
  };

  const headline =
    overview.totalAttempts === 0
      ? "Baseline Calibration Ready"
      : `Focus on ${priorityOps.map((o) => o.toUpperCase()).join(" & ")} Speed & Accuracy`;

  return {
    weights,
    priorityOps,
    headline,
    bullets,
    recommendedConfig,
  };
}

export class LocalJsonStore implements DeskMathStore {
  public readonly backend = "local" as const;
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly mediaDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ??
      process.env.LOCAL_DATA_DIR ??
      path.join(process.cwd(), ".local-data");
    this.storePath = path.join(this.dataDir, "store.json");
    this.mediaDir = path.join(this.dataDir, "media");
  }

  private async readState(): Promise<LocalStoreFile> {
    try {
      const text = await fs.readFile(this.storePath, "utf8");
      const parsed = JSON.parse(text) as Partial<LocalStoreFile>;
      return {
        sessions: parsed.sessions ?? [],
        attempts: parsed.attempts ?? [],
        coachMessages: parsed.coachMessages ?? [],
        settings: { ...defaultRawSettings(), ...(parsed.settings ?? {}) },
      };
    } catch {
      return {
        sessions: [],
        attempts: [],
        coachMessages: [],
        settings: defaultRawSettings(),
      };
    }
  }

  private async mutateState<T>(
    fn: (state: LocalStoreFile) => T | Promise<T>,
  ): Promise<T> {
    let result!: T;
    const nextOp = this.writeQueue.then(async () => {
      await fs.mkdir(this.dataDir, { recursive: true });
      const state = await this.readState();
      result = await fn(state);
      const tmp = `${this.storePath}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
      await fs.rename(tmp, this.storePath);
    });
    this.writeQueue = nextOp.catch(() => {});
    await nextOp;
    return result;
  }

  async saveSessionWithAttempts(input: SaveSessionInput) {
    return this.mutateState((state) => {
      const built = buildSessionAndAttempts(input);
      state.sessions.unshift(built.session);
      state.attempts.unshift(...built.attempts);
      return built;
    });
  }

  async getSessions(limit = 30) {
    const state = await this.readState();
    return [...state.sessions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getSessionDetail(id: string) {
    const state = await this.readState();
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return null;
    const attempts = state.attempts
      .filter((a) => a.sessionId === id)
      .sort((a, b) => a.seq - b.seq);
    return { session, attempts };
  }

  async getAttemptById(id: string) {
    const state = await this.readState();
    return state.attempts.find((a) => a.id === id) ?? null;
  }

  async getAttempts(filters: AttemptQueryFilters) {
    const state = await this.readState();
    return filterAttemptList(state.attempts, filters);
  }

  async updateAttempt(
    id: string,
    patch: { reviewed?: boolean; note?: string | null },
  ) {
    return this.mutateState((state) => {
      const idx = state.attempts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const cur = state.attempts[idx];
      const updated: AttemptRecord = {
        ...cur,
        reviewed: patch.reviewed !== undefined ? patch.reviewed : cur.reviewed,
        note: patch.note !== undefined ? patch.note : cur.note,
      };
      state.attempts[idx] = updated;
      return updated;
    });
  }

  async getOverviewStats() {
    const state = await this.readState();
    return computeOverview(state.sessions, state.attempts);
  }

  async getWeaknessProfile() {
    const state = await this.readState();
    const pub = toPublicSettings(state.settings, this.backend);
    const ov = computeOverview(state.sessions, state.attempts);
    return computeWeakness(ov, pub);
  }

  async getCoachMessages(limit = 60) {
    const state = await this.readState();
    return [...state.coachMessages]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  }

  async addCoachMessage(msg: Omit<CoachMessageRecord, "id" | "createdAt">) {
    return this.mutateState((state) => {
      const record: CoachMessageRecord = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        ...msg,
      };
      state.coachMessages.push(record);
      return record;
    });
  }

  async clearCoachMessages() {
    await this.mutateState((state) => {
      state.coachMessages = [];
    });
  }

  async getSettings() {
    const state = await this.readState();
    return toPublicSettings(state.settings, this.backend);
  }

  async getEffectiveGeminiConfig() {
    const state = await this.readState();
    const s = state.settings;
    return {
      provider: s.aiProvider,
      primaryModel: s.geminiPrimaryModel,
      liteModel: s.geminiLiteModel,
      apiKey: s.geminiApiKey.trim() || (process.env.GEMINI_API_KEY ?? "").trim(),
    };
  }

  async updateSettings(patch: SettingsPatch) {
    return this.mutateState((state) => {
      state.settings = applySettingsPatch(state.settings, patch);
      return toPublicSettings(state.settings, this.backend);
    });
  }

  async exportAllData() {
    const state = await this.readState();
    const settings = toPublicSettings(state.settings, this.backend);
    const overview = computeOverview(state.sessions, state.attempts);
    return {
      exportedAt: new Date().toISOString(),
      settings,
      overview,
      sessions: state.sessions,
      attempts: state.attempts.slice(0, 500),
    };
  }

  async resetTrainingData() {
    await this.mutateState((state) => {
      state.sessions = [];
      state.attempts = [];
      state.coachMessages = [];
    });
  }

  async readMedia(relativePath: string): Promise<MediaPayload | null> {
    const safe = sanitizeMediaPath(relativePath);
    const fullPath = path.join(this.mediaDir, safe);
    try {
      const buffer = await fs.readFile(fullPath);
      const ext = path.extname(safe).toLowerCase();
      const contentType =
        ext === ".mp3"
          ? "audio/mpeg"
          : ext === ".wav"
            ? "audio/wav"
            : ext === ".json"
              ? "application/json"
              : "application/octet-stream";
      return { buffer, contentType };
    } catch {
      return null;
    }
  }

  async writeMedia(
    relativePath: string,
    buffer: Buffer,
    _contentType?: string,
  ): Promise<void> {
    void _contentType;
    const safe = sanitizeMediaPath(relativePath);
    const fullPath = path.join(this.mediaDir, safe);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }
}

export class GcpFirestoreStore implements DeskMathStore {
  public readonly backend = "gcp" as const;
  private readonly firestore: Firestore;
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly namespace: string;

  constructor() {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
    const databaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";
    this.firestore = new Firestore({
      ...(projectId ? { projectId } : {}),
      databaseId,
      ignoreUndefinedProperties: true,
    });
    this.storage = new Storage(projectId ? { projectId } : undefined);
    this.bucketName = process.env.GCS_BUCKET_NAME ?? "";
    this.namespace = process.env.FIRESTORE_NAMESPACE ?? "deskmath";
  }

  private col(name: string) {
    return this.firestore
      .collection(this.namespace)
      .doc("v1")
      .collection(name);
  }

  private settingsDoc() {
    return this.firestore
      .collection(this.namespace)
      .doc("v1")
      .collection("meta")
      .doc("settings");
  }

  private async readSettingsRaw(): Promise<StoredSettingsRaw> {
    const snap = await this.settingsDoc().get();
    if (!snap.exists) return defaultRawSettings();
    return {
      ...defaultRawSettings(),
      ...(snap.data() as Partial<StoredSettingsRaw>),
    };
  }

  async saveSessionWithAttempts(input: SaveSessionInput) {
    const built = buildSessionAndAttempts(input);
    const batch = this.firestore.batch();
    batch.set(this.col("sessions").doc(built.session.id), built.session);
    // Firestore batch supports up to 500 writes
    for (const att of built.attempts.slice(0, 450)) {
      batch.set(this.col("attempts").doc(att.id), att);
    }
    await batch.commit();
    return built;
  }

  async getSessions(limit = 30) {
    const snap = await this.col("sessions")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as SessionRecord);
  }

  async getSessionDetail(id: string) {
    const sDoc = await this.col("sessions").doc(id).get();
    if (!sDoc.exists) return null;
    const aSnap = await this.col("attempts")
      .where("sessionId", "==", id)
      .get();
    const attempts = aSnap.docs
      .map((d) => d.data() as AttemptRecord)
      .sort((a, b) => a.seq - b.seq);
    return { session: sDoc.data() as SessionRecord, attempts };
  }

  async getAttemptById(id: string) {
    const doc = await this.col("attempts").doc(id).get();
    return doc.exists ? (doc.data() as AttemptRecord) : null;
  }

  async getAttempts(filters: AttemptQueryFilters) {
    const snap = await this.col("attempts")
      .orderBy("createdAt", "desc")
      .limit(600)
      .get();
    const all = snap.docs.map((d) => d.data() as AttemptRecord);
    return filterAttemptList(all, filters);
  }

  async updateAttempt(
    id: string,
    patch: { reviewed?: boolean; note?: string | null },
  ) {
    const ref = this.col("attempts").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const cur = snap.data() as AttemptRecord;
    const updated: AttemptRecord = {
      ...cur,
      reviewed: patch.reviewed !== undefined ? patch.reviewed : cur.reviewed,
      note: patch.note !== undefined ? patch.note : cur.note,
    };
    await ref.set(updated);
    return updated;
  }

  async getOverviewStats() {
    const [sSnap, aSnap] = await Promise.all([
      this.col("sessions").orderBy("createdAt", "desc").limit(200).get(),
      this.col("attempts").orderBy("createdAt", "desc").limit(1500).get(),
    ]);
    return computeOverview(
      sSnap.docs.map((d) => d.data() as SessionRecord),
      aSnap.docs.map((d) => d.data() as AttemptRecord),
    );
  }

  async getWeaknessProfile() {
    const [rawSettings, overview] = await Promise.all([
      this.readSettingsRaw(),
      this.getOverviewStats(),
    ]);
    return computeWeakness(overview, toPublicSettings(rawSettings, this.backend));
  }

  async getCoachMessages(limit = 60) {
    const snap = await this.col("coachMessages")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => d.data() as CoachMessageRecord)
      .reverse();
  }

  async addCoachMessage(msg: Omit<CoachMessageRecord, "id" | "createdAt">) {
    const record: CoachMessageRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...msg,
    };
    await this.col("coachMessages").doc(record.id).set(record);
    return record;
  }

  async clearCoachMessages() {
    const snap = await this.col("coachMessages").limit(400).get();
    if (snap.empty) return;
    const batch = this.firestore.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
  }

  async getSettings() {
    const raw = await this.readSettingsRaw();
    return toPublicSettings(raw, this.backend);
  }

  async getEffectiveGeminiConfig() {
    const s = await this.readSettingsRaw();
    return {
      provider: s.aiProvider,
      primaryModel: s.geminiPrimaryModel,
      liteModel: s.geminiLiteModel,
      apiKey: s.geminiApiKey.trim() || (process.env.GEMINI_API_KEY ?? "").trim(),
    };
  }

  async updateSettings(patch: SettingsPatch) {
    const cur = await this.readSettingsRaw();
    const next = applySettingsPatch(cur, patch);
    await this.settingsDoc().set(next);
    return toPublicSettings(next, this.backend);
  }

  async exportAllData() {
    const [settings, overview, sessions, attempts] = await Promise.all([
      this.getSettings(),
      this.getOverviewStats(),
      this.getSessions(200),
      this.getAttempts({ issueFilter: "all", limit: 500 }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      settings,
      overview,
      sessions,
      attempts,
    };
  }

  async resetTrainingData() {
    for (const colName of ["attempts", "sessions", "coachMessages"]) {
      const snap = await this.col(colName).limit(450).get();
      if (!snap.empty) {
        const batch = this.firestore.batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
      }
    }
  }

  async readMedia(relativePath: string): Promise<MediaPayload | null> {
    if (!this.bucketName) return null;
    const safe = sanitizeMediaPath(relativePath);
    const file = this.storage.bucket(this.bucketName).file(safe);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      buffer,
      contentType: meta.contentType ?? "application/octet-stream",
    };
  }

  async writeMedia(
    relativePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.bucketName) return;
    const safe = sanitizeMediaPath(relativePath);
    const file = this.storage.bucket(this.bucketName).file(safe);
    await file.save(buffer, { contentType, resumable: false });
  }
}

let singletonStore: DeskMathStore | null = null;

export function getStore(): DeskMathStore {
  if (!singletonStore) {
    const mode = process.env.STORAGE_BACKEND === "gcp" ? "gcp" : "local";
    singletonStore =
      mode === "gcp" ? new GcpFirestoreStore() : new LocalJsonStore();
  }
  return singletonStore;
}
