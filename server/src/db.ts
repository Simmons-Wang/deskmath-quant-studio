import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  analyzeProblemTrick,
  classifyAttemptError,
  classifyPatternTag,
  computeExpectedAnswer,
  DRILL_PRESETS,
  type AttemptStatus,
  type DrillConfig,
  type ErrorCategory,
  type Operation,
  type TrainingMode,
} from '../../shared/math.js';

export interface AttemptInput {
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
}

export interface SaveSessionInput {
  mode: TrainingMode;
  preset: string;
  format: string;
  submissionMode: string;
  durationLimitSec?: number | null;
  questionLimit?: number | null;
  targetMs: number;
  operations: Operation[];
  allowNegative: boolean;
  elapsedMs: number;
  attempts: AttemptInput[];
}

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
  weakPatterns: Array<{ patternTag: string; op: Operation; total: number; issueCount: number; meanMs: number }>;
  recentSessions: SessionRecord[];
}

export interface WeaknessProfile {
  weights: Record<Operation, number>;
  priorityOps: Operation[];
  headline: string;
  bullets: string[];
  recommendedConfig: DrillConfig;
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
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export class QuantDatabase {
  public readonly db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ??
      process.env.DATABASE_PATH ??
      path.join(process.cwd(), 'data', 'quantmath.db');

    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        mode TEXT NOT NULL,
        preset TEXT NOT NULL,
        format TEXT NOT NULL,
        submission_mode TEXT NOT NULL,
        duration_limit_sec INTEGER,
        question_limit INTEGER,
        target_ms INTEGER NOT NULL,
        ops_json TEXT NOT NULL,
        allow_negative INTEGER NOT NULL,
        total_attempts INTEGER NOT NULL,
        correct_count INTEGER NOT NULL,
        wrong_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        timeout_count INTEGER NOT NULL,
        slow_correct_count INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        ppm REAL NOT NULL,
        mean_ms REAL NOT NULL,
        median_ms REAL NOT NULL,
        p90_ms REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        op TEXT NOT NULL,
        a INTEGER NOT NULL,
        b INTEGER NOT NULL,
        correct_answer INTEGER NOT NULL,
        user_answer INTEGER,
        raw_input TEXT,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        reaction_ms INTEGER NOT NULL,
        processing_ms INTEGER,
        is_slow INTEGER NOT NULL,
        error_category TEXT NOT NULL,
        pattern_tag TEXT NOT NULL,
        trick_summary TEXT NOT NULL,
        reviewed INTEGER NOT NULL DEFAULT 0,
        note TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
      CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status, is_slow);
      CREATE INDEX IF NOT EXISTS idx_attempts_op ON attempts(op);

      CREATE TABLE IF NOT EXISTS coach_messages (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        focus_attempt_id TEXT,
        provider TEXT NOT NULL,
        recommended_drill_json TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  saveSessionWithAttempts(input: SaveSessionInput): { session: SessionRecord; attempts: AttemptRecord[] } {
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();

    const enriched = input.attempts.map((att, index) => {
      const correctAnswer = computeExpectedAnswer(att.op, att.a, att.b);
      const status: AttemptStatus =
        att.status === 'correct' && att.userAnswer === correctAnswer
          ? 'correct'
          : att.status === 'skipped' || att.status === 'timeout'
            ? att.status
            : att.userAnswer === correctAnswer
              ? 'correct'
              : 'wrong';

      const reactionMs = Math.max(50, Math.round(att.reactionMs));
      const processingMs =
        att.processingMs !== undefined && att.processingMs !== null
          ? Math.max(50, Math.round(att.processingMs))
          : null;
      const isSlow = status === 'correct' && reactionMs > input.targetMs;
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
      } satisfies AttemptRecord;
    });

    const totalAttempts = enriched.length;
    const correctCount = enriched.filter((x) => x.status === 'correct').length;
    const wrongCount = enriched.filter((x) => x.status === 'wrong').length;
    const skippedCount = enriched.filter((x) => x.status === 'skipped').length;
    const timeoutCount = enriched.filter((x) => x.status === 'timeout').length;
    const slowCorrectCount = enriched.filter((x) => x.isSlow).length;

    const elapsedMs = Math.max(1000, Math.round(input.elapsedMs));
    const ppm = Number(((correctCount / elapsedMs) * 60_000).toFixed(2));
    const latencies = enriched.map((x) => x.reactionMs).sort((x, y) => x - y);
    const meanMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
        : 0;
    const medianMs = percentile(latencies, 50);
    const p90Ms = percentile(latencies, 90);

    const insertSession = this.db.prepare(`
      INSERT INTO sessions (
        id, created_at, mode, preset, format, submission_mode,
        duration_limit_sec, question_limit, target_ms, ops_json, allow_negative,
        total_attempts, correct_count, wrong_count, skipped_count, timeout_count,
        slow_correct_count, elapsed_ms, ppm, mean_ms, median_ms, p90_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAttempt = this.db.prepare(`
      INSERT INTO attempts (
        id, session_id, created_at, seq, op, a, b, correct_answer, user_answer,
        raw_input, status, mode, reaction_ms, processing_ms, is_slow,
        error_category, pattern_tag, trick_summary, reviewed, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      insertSession.run(
        sessionId,
        createdAt,
        input.mode,
        input.preset,
        input.format,
        input.submissionMode,
        input.durationLimitSec ?? null,
        input.questionLimit ?? null,
        input.targetMs,
        JSON.stringify(input.operations),
        input.allowNegative ? 1 : 0,
        totalAttempts,
        correctCount,
        wrongCount,
        skippedCount,
        timeoutCount,
        slowCorrectCount,
        elapsedMs,
        ppm,
        meanMs,
        medianMs,
        p90Ms,
      );

      for (const att of enriched) {
        insertAttempt.run(
          att.id,
          att.sessionId,
          att.createdAt,
          att.seq,
          att.op,
          att.a,
          att.b,
          att.correctAnswer,
          att.userAnswer,
          att.rawInput,
          att.status,
          att.mode,
          att.reactionMs,
          att.processingMs,
          att.isSlow ? 1 : 0,
          att.errorCategory,
          att.patternTag,
          att.trickSummary,
          0,
          null,
        );
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

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
      medianMs,
      p90Ms,
    };

    return { session, attempts: enriched };
  }

  private mapSessionRow(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      createdAt: String(row.created_at),
      mode: String(row.mode) as TrainingMode,
      preset: String(row.preset),
      format: String(row.format),
      submissionMode: String(row.submission_mode),
      durationLimitSec: row.duration_limit_sec === null ? null : Number(row.duration_limit_sec),
      questionLimit: row.question_limit === null ? null : Number(row.question_limit),
      targetMs: Number(row.target_ms),
      operations: JSON.parse(String(row.ops_json)) as Operation[],
      allowNegative: Number(row.allow_negative) === 1,
      totalAttempts: Number(row.total_attempts),
      correctCount: Number(row.correct_count),
      wrongCount: Number(row.wrong_count),
      skippedCount: Number(row.skipped_count),
      timeoutCount: Number(row.timeout_count),
      slowCorrectCount: Number(row.slow_correct_count),
      elapsedMs: Number(row.elapsed_ms),
      ppm: Number(row.ppm),
      meanMs: Number(row.mean_ms),
      medianMs: Number(row.median_ms),
      p90Ms: Number(row.p90_ms),
    };
  }

  private mapAttemptRow(row: Record<string, unknown>): AttemptRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      createdAt: String(row.created_at),
      seq: Number(row.seq),
      op: String(row.op) as Operation,
      a: Number(row.a),
      b: Number(row.b),
      correctAnswer: Number(row.correct_answer),
      userAnswer: row.user_answer === null ? null : Number(row.user_answer),
      rawInput: row.raw_input === null ? null : String(row.raw_input),
      status: String(row.status) as AttemptStatus,
      mode: String(row.mode) as TrainingMode,
      reactionMs: Number(row.reaction_ms),
      processingMs: row.processing_ms === null ? null : Number(row.processing_ms),
      isSlow: Number(row.is_slow) === 1,
      errorCategory: String(row.error_category) as ErrorCategory,
      patternTag: String(row.pattern_tag),
      trickSummary: String(row.trick_summary),
      reviewed: Number(row.reviewed) === 1,
      note: row.note === null ? null : String(row.note),
    };
  }

  getSessions(limit = 30): SessionRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?`);
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSessionRow(r));
  }

  getSessionDetail(id: string): { session: SessionRecord; attempts: AttemptRecord[] } | null {
    const sRow = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!sRow) return null;
    const aRows = this.db
      .prepare(`SELECT * FROM attempts WHERE session_id = ? ORDER BY seq ASC`)
      .all(id) as Array<Record<string, unknown>>;
    return {
      session: this.mapSessionRow(sRow),
      attempts: aRows.map((r) => this.mapAttemptRow(r)),
    };
  }

  getAttemptById(id: string): AttemptRecord | null {
    const row = this.db.prepare(`SELECT * FROM attempts WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapAttemptRow(row) : null;
  }

  getAttempts(filters: {
    issueFilter?: 'all' | 'issues' | 'wrong' | 'skipped_timeout' | 'slow';
    op?: Operation | 'all';
    mode?: 'all' | 'visual' | 'voice';
    sessionId?: string;
    limit?: number;
  }): AttemptRecord[] {
    const conditions: string[] = [];
    const args: Array<string | number> = [];

    if (filters.issueFilter === 'issues') {
      conditions.push(`(status != 'correct' OR is_slow = 1)`);
    } else if (filters.issueFilter === 'wrong') {
      conditions.push(`status = 'wrong'`);
    } else if (filters.issueFilter === 'skipped_timeout') {
      conditions.push(`status IN ('skipped', 'timeout')`);
    } else if (filters.issueFilter === 'slow') {
      conditions.push(`is_slow = 1`);
    }

    if (filters.op && filters.op !== 'all') {
      conditions.push(`op = ?`);
      args.push(filters.op);
    }

    if (filters.mode === 'visual') {
      conditions.push(`mode = 'visual'`);
    } else if (filters.mode === 'voice') {
      conditions.push(`mode IN ('voice_keys', 'voice_handsfree')`);
    }

    if (filters.sessionId) {
      conditions.push(`session_id = ?`);
      args.push(filters.sessionId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, filters.limit ?? 150));
    args.push(limit);

    const rows = this.db
      .prepare(`SELECT * FROM attempts ${whereClause} ORDER BY created_at DESC, seq DESC LIMIT ?`)
      .all(...args) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapAttemptRow(r));
  }

  updateAttempt(id: string, patch: { reviewed?: boolean; note?: string | null }): AttemptRecord | null {
    const existing = this.getAttemptById(id);
    if (!existing) return null;

    const nextReviewed = patch.reviewed !== undefined ? (patch.reviewed ? 1 : 0) : existing.reviewed ? 1 : 0;
    const nextNote = patch.note !== undefined ? patch.note : existing.note;

    this.db
      .prepare(`UPDATE attempts SET reviewed = ?, note = ? WHERE id = ?`)
      .run(nextReviewed, nextNote, id);

    return this.getAttemptById(id);
  }

  getOverviewStats(): OverviewStats {
    const summaryRow = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total_sessions,
          COALESCE(MAX(ppm), 0) AS best_ppm
        FROM sessions
      `)
      .get() as Record<string, unknown>;

    const attemptRows = this.db
      .prepare(`SELECT * FROM attempts ORDER BY created_at DESC LIMIT 2000`)
      .all() as Array<Record<string, unknown>>;

    const attempts = attemptRows.map((r) => this.mapAttemptRow(r));
    const totalAttempts = attempts.length;
    const correctTotal = attempts.filter((a) => a.status === 'correct').length;
    const overallAccuracyPct =
      totalAttempts > 0 ? Number(((correctTotal / totalAttempts) * 100).toFixed(1)) : 0;
    const overallMeanMs =
      totalAttempts > 0
        ? Math.round(attempts.reduce((sum, a) => sum + a.reactionMs, 0) / totalAttempts)
        : 0;
    const unreviewedIssuesCount = attempts.filter(
      (a) => (a.status !== 'correct' || a.isSlow) && !a.reviewed,
    ).length;

    const ops: Operation[] = ['add', 'sub', 'mul', 'div'];
    const opStats: OpStats[] = ops.map((op) => {
      const list = attempts.filter((a) => a.op === op);
      const correct = list.filter((a) => a.status === 'correct').length;
      const wrong = list.filter((a) => a.status === 'wrong').length;
      const skippedOrTimeout = list.filter((a) => a.status === 'skipped' || a.status === 'timeout').length;
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

    const modeBuckets: Array<'visual' | 'voice'> = ['visual', 'voice'];
    const modeStats: ModeStats[] = modeBuckets.map((bucket) => {
      const list = attempts.filter((a) =>
        bucket === 'visual' ? a.mode === 'visual' : a.mode !== 'visual',
      );
      const correct = list.filter((a) => a.status === 'correct').length;
      const meanMs =
        list.length > 0 ? Math.round(list.reduce((s, a) => s + a.reactionMs, 0) / list.length) : 0;
      const proc = list.map((a) => a.processingMs).filter((x): x is number => x !== null);
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
    for (const a of attempts) {
      if (a.errorCategory !== 'none') {
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
    for (const a of attempts) {
      const entry = patternMap.get(a.patternTag) ?? {
        patternTag: a.patternTag,
        op: a.op,
        total: 0,
        issueCount: 0,
        latencySum: 0,
      };
      entry.total += 1;
      if (a.status !== 'correct' || a.isSlow) entry.issueCount += 1;
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
      .sort((a, b) => b.issueCount / b.total - a.issueCount / a.total || b.meanMs - a.meanMs)
      .slice(0, 6);

    return {
      totalSessions: Number(summaryRow.total_sessions),
      totalAttempts,
      overallAccuracyPct,
      overallMeanMs,
      bestPpm: Number(summaryRow.best_ppm),
      unreviewedIssuesCount,
      opStats,
      modeStats,
      errorBreakdown,
      weakPatterns,
      recentSessions: this.getSessions(12),
    };
  }

  getWeaknessProfile(): WeaknessProfile {
    const overview = this.getOverviewStats();
    const settings = this.getSettings();
    const targetMs = settings.targetMs;

    const weights: Record<Operation, number> = {
      add: 1,
      sub: 1,
      mul: 1.4,
      div: 1.3,
    };

    const opScores = overview.opStats.map((stat) => {
      if (stat.total === 0) {
        return { op: stat.op, score: stat.op === 'mul' || stat.op === 'div' ? 1.4 : 1 };
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
      bullets.push('No drill telemetry logged yet — starting with balanced 3-digit addition/subtraction and 2×2 multiplication.');
      bullets.push('Keep target reaction speed under 3.5s per problem; switch between Visual and Voice modes to benchmark auditory latency.');
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
          `Most frequent breakdown: ${topError.category.replace(/_/g, ' ')} (${topError.count} occurrences).`,
        );
      }

      const visual = overview.modeStats.find((m) => m.bucket === 'visual');
      const voice = overview.modeStats.find((m) => m.bucket === 'voice');
      if (visual && voice && visual.total > 0 && voice.total > 0) {
        const delta = voice.meanMs - visual.meanMs;
        bullets.push(
          `Voice vs Visual latency delta: ${delta >= 0 ? '+' : ''}${(delta / 1000).toFixed(2)}s (${(voice.meanMs / 1000).toFixed(2)}s voice vs ${(visual.meanMs / 1000).toFixed(2)}s visual).`,
        );
      }
    }

    const basePreset = structuredClone(DRILL_PRESETS.weakness_drill.config);
    const recommendedConfig: DrillConfig = {
      ...basePreset,
      mode: 'visual',
      blindVoiceMode: true,
      speechRate: settings.speechRate,
      targetMs,
      operationWeights: weights,
    };

    const headline =
      overview.totalAttempts === 0
        ? 'Baseline Calibration Ready'
        : `Focus on ${priorityOps.map((o) => o.toUpperCase()).join(' & ')} Speed & Accuracy`;

    return {
      weights,
      priorityOps,
      headline,
      bullets,
      recommendedConfig,
    };
  }

  getCoachMessages(limit = 50): CoachMessageRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM coach_messages ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at),
      role: String(r.role) as 'user' | 'assistant',
      content: String(r.content),
      focusAttemptId: r.focus_attempt_id === null ? null : String(r.focus_attempt_id),
      provider: String(r.provider) as 'builtin' | 'openai' | 'gemini',
      recommendedDrill: r.recommended_drill_json
        ? (JSON.parse(String(r.recommended_drill_json)) as RecommendedDrill)
        : null,
    }));
  }

  addCoachMessage(msg: Omit<CoachMessageRecord, 'id' | 'createdAt'>): CoachMessageRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO coach_messages (
          id, created_at, role, content, focus_attempt_id, provider, recommended_drill_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        createdAt,
        msg.role,
        msg.content,
        msg.focusAttemptId,
        msg.provider,
        msg.recommendedDrill ? JSON.stringify(msg.recommendedDrill) : null,
      );
    return { id, createdAt, ...msg };
  }

  clearCoachMessages(): void {
    this.db.exec(`DELETE FROM coach_messages;`);
  }

  private getSettingRaw(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  private setSettingRaw(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, value);
  }

  getSettings(): PublicSettings {
    const rawKey = this.getSettingRaw('aiApiKey') ?? '';
    const providerRaw = this.getSettingRaw('aiProvider');
    const aiProvider: 'builtin' | 'openai' | 'gemini' =
      providerRaw === 'openai' || providerRaw === 'gemini' ? providerRaw : 'builtin';

    return {
      targetMs: Number(this.getSettingRaw('targetMs') ?? 3500),
      speechRate: Number(this.getSettingRaw('speechRate') ?? 1.25),
      voiceName: this.getSettingRaw('voiceName') ?? '',
      soundEnabled: (this.getSettingRaw('soundEnabled') ?? 'true') === 'true',
      aiProvider,
      aiModel:
        this.getSettingRaw('aiModel') ??
        (aiProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
      hasApiKey: rawKey.trim().length > 0,
      maskedApiKey: rawKey.trim().length > 0 ? maskKey(rawKey) : null,
    };
  }

  getRawAiConfig(): { provider: 'builtin' | 'openai' | 'gemini'; model: string; apiKey: string } {
    const publicSettings = this.getSettings();
    return {
      provider: publicSettings.aiProvider,
      model: publicSettings.aiModel,
      apiKey: (this.getSettingRaw('aiApiKey') ?? '').trim(),
    };
  }

  updateSettings(patch: {
    targetMs?: number;
    speechRate?: number;
    voiceName?: string;
    soundEnabled?: boolean;
    aiProvider?: 'builtin' | 'openai' | 'gemini';
    aiModel?: string;
    aiApiKey?: string | null;
  }): PublicSettings {
    if (patch.targetMs !== undefined) {
      this.setSettingRaw('targetMs', String(Math.min(15000, Math.max(800, Math.round(patch.targetMs)))));
    }
    if (patch.speechRate !== undefined) {
      this.setSettingRaw('speechRate', String(Math.min(2.2, Math.max(0.7, patch.speechRate))));
    }
    if (patch.voiceName !== undefined) {
      this.setSettingRaw('voiceName', patch.voiceName);
    }
    if (patch.soundEnabled !== undefined) {
      this.setSettingRaw('soundEnabled', patch.soundEnabled ? 'true' : 'false');
    }
    if (patch.aiProvider !== undefined) {
      this.setSettingRaw('aiProvider', patch.aiProvider);
    }
    if (patch.aiModel !== undefined) {
      this.setSettingRaw('aiModel', patch.aiModel.trim());
    }
    if (patch.aiApiKey !== undefined) {
      if (patch.aiApiKey === null || patch.aiApiKey.trim() === '') {
        this.db.prepare(`DELETE FROM settings WHERE key = 'aiApiKey'`).run();
      } else {
        this.setSettingRaw('aiApiKey', patch.aiApiKey.trim());
      }
    }
    return this.getSettings();
  }

  exportAllData(): {
    exportedAt: string;
    settings: PublicSettings;
    overview: OverviewStats;
    sessions: SessionRecord[];
    attempts: AttemptRecord[];
  } {
    return {
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      overview: this.getOverviewStats(),
      sessions: this.getSessions(500),
      attempts: this.getAttempts({ limit: 500 }),
    };
  }

  resetTrainingData(): void {
    this.db.exec(`
      DELETE FROM attempts;
      DELETE FROM sessions;
      DELETE FROM coach_messages;
    `);
  }
}
