export type Operation = "add" | "sub" | "mul" | "div";

export type TrainingMode = "visual" | "voice_keys" | "voice_handsfree";

export type DrillFormat = "timed" | "fixed" | "endless";

export type SubmissionMode = "exact_auto" | "length_auto" | "enter";

export type PresetId =
  | "desk_pro"
  | "zetamac_120"
  | "warmup_20"
  | "weakness_drill"
  | "custom";

export type AttemptStatus = "correct" | "wrong" | "skipped" | "timeout";

export type ErrorCategory =
  | "none"
  | "off_by_10_power"
  | "off_by_unit"
  | "sign_error"
  | "digit_transposition"
  | "magnitude_error"
  | "early_typo"
  | "skipped"
  | "timeout"
  | "slow_solve";

export interface OperationRanges {
  add: { minA: number; maxA: number; minB: number; maxB: number };
  sub: {
    minA: number;
    maxA: number;
    minB: number;
    maxB: number;
    allowNegative: boolean;
  };
  mul: { minA: number; maxA: number; minB: number; maxB: number };
  div: {
    minDivisor: number;
    maxDivisor: number;
    minQuotient: number;
    maxQuotient: number;
  };
}

export interface DrillConfig {
  preset: PresetId;
  mode: TrainingMode;
  format: DrillFormat;
  submissionMode: SubmissionMode;
  durationSec: number;
  questionCount: number;
  targetMs: number;
  operations: Operation[];
  operationWeights?: Partial<Record<Operation, number>>;
  ranges: OperationRanges;
  blindVoiceMode: boolean;
  speechRate: number;
}

export interface MathProblem {
  id: string;
  op: Operation;
  a: number;
  b: number;
  answer: number;
  displayText: string;
  spokenText: string;
  patternTag: string;
}

export interface TrickAnalysis {
  strategyName: string;
  steps: string[];
  shortcutTip: string;
  summary: string;
}

export interface PresetMeta {
  id: PresetId;
  name: string;
  subtitle: string;
  badge: string;
  config: Omit<DrillConfig, "mode" | "blindVoiceMode" | "speechRate">;
}

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
  preset: "weakness_drill" | "custom";
  operations: Operation[];
  mode?: TrainingMode;
  operationWeights?: Partial<Record<Operation, number>>;
  targetMs?: number;
}

export type CoachProvider = "builtin" | "gemini";

export interface CoachMessageRecord {
  id: string;
  createdAt: string;
  role: "user" | "assistant";
  content: string;
  focusAttemptId: string | null;
  provider: CoachProvider;
  modelUsed?: string | null;
  recommendedDrill: RecommendedDrill | null;
}

export interface PublicSettings {
  targetMs: number;
  speechRate: number;
  voiceName: string;
  soundEnabled: boolean;
  cloudTtsEnabled: boolean;
  aiProvider: CoachProvider;
  geminiPrimaryModel: string;
  geminiLiteModel: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  storageBackend: "local" | "gcp";
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
  bucket: "visual" | "voice";
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

export interface PublicAuthConfig {
  authRequired: boolean;
  firebaseConfigured: boolean;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
  } | null;
}

export const OP_SYMBOL: Record<Operation, string> = {
  add: "+",
  sub: "−",
  mul: "×",
  div: "÷",
};

export const OP_LABEL: Record<Operation, string> = {
  add: "Addition",
  sub: "Subtraction",
  mul: "Multiplication",
  div: "Division",
};

export const ERROR_CATEGORY_LABEL: Record<ErrorCategory, string> = {
  none: "Clean",
  off_by_10_power: "Carry / Place-Value Slip",
  off_by_unit: "Units-Digit Slip",
  sign_error: "Sign Inversion",
  digit_transposition: "Digit Transposition",
  magnitude_error: "Magnitude / Estimate Error",
  early_typo: "Partial / Typing Error",
  skipped: "Skipped",
  timeout: "Timed Out",
  slow_solve: "Slow Process Speed",
};

export const DRILL_PRESETS: Record<Exclude<PresetId, "custom">, PresetMeta> = {
  desk_pro: {
    id: "desk_pro",
    name: "Desk Pro (3-Digit & 2×2)",
    subtitle: "Mixed 154+353, 56×23, integer subtraction & exact division",
    badge: "25 Q · 3.5s Pace",
    config: {
      preset: "desk_pro",
      format: "fixed",
      submissionMode: "enter",
      durationSec: 180,
      questionCount: 25,
      targetMs: 3500,
      operations: ["add", "sub", "mul", "div"],
      ranges: {
        add: { minA: 110, maxA: 599, minB: 110, maxB: 599 },
        sub: { minA: 120, maxA: 899, minB: 110, maxB: 599, allowNegative: false },
        mul: { minA: 13, maxA: 89, minB: 12, maxB: 49 },
        div: { minDivisor: 11, maxDivisor: 39, minQuotient: 12, maxQuotient: 89 },
      },
    },
  },
  zetamac_120: {
    id: "zetamac_120",
    name: "Zetamac 120s Sprint",
    subtitle: "Classic 2-minute quant interview throughput benchmark",
    badge: "120s · Exact Auto",
    config: {
      preset: "zetamac_120",
      format: "timed",
      submissionMode: "exact_auto",
      durationSec: 120,
      questionCount: 50,
      targetMs: 2200,
      operations: ["add", "sub", "mul", "div"],
      ranges: {
        add: { minA: 12, maxA: 180, minB: 12, maxB: 180 },
        sub: { minA: 12, maxA: 250, minB: 12, maxB: 180, allowNegative: false },
        mul: { minA: 3, maxA: 19, minB: 11, maxB: 99 },
        div: { minDivisor: 3, maxDivisor: 19, minQuotient: 11, maxQuotient: 99 },
      },
    },
  },
  warmup_20: {
    id: "warmup_20",
    name: "Rapid Warmup (20 Q)",
    subtitle: "Fast fluency calibration across all four integer ops",
    badge: "20 Q · Length Auto",
    config: {
      preset: "warmup_20",
      format: "fixed",
      submissionMode: "length_auto",
      durationSec: 90,
      questionCount: 20,
      targetMs: 2500,
      operations: ["add", "sub", "mul", "div"],
      ranges: {
        add: { minA: 25, maxA: 250, minB: 25, maxB: 250 },
        sub: { minA: 35, maxA: 350, minB: 20, maxB: 200, allowNegative: false },
        mul: { minA: 11, maxA: 35, minB: 4, maxB: 19 },
        div: { minDivisor: 4, maxDivisor: 19, minQuotient: 11, maxQuotient: 45 },
      },
    },
  },
  weakness_drill: {
    id: "weakness_drill",
    name: "Weakness Targeted (15 Q)",
    subtitle: "Adaptive mix weighted toward your slowest and missed operations",
    badge: "15 Q · Adaptive",
    config: {
      preset: "weakness_drill",
      format: "fixed",
      submissionMode: "enter",
      durationSec: 120,
      questionCount: 15,
      targetMs: 3200,
      operations: ["add", "sub", "mul", "div"],
      ranges: {
        add: { minA: 110, maxA: 599, minB: 110, maxB: 599 },
        sub: { minA: 120, maxA: 899, minB: 110, maxB: 599, allowNegative: true },
        mul: { minA: 14, maxA: 89, minB: 12, maxB: 49 },
        div: { minDivisor: 11, maxDivisor: 39, minQuotient: 12, maxQuotient: 89 },
      },
    },
  },
};

export function createDefaultDrillConfig(): DrillConfig {
  return {
    ...structuredClone(DRILL_PRESETS.desk_pro.config),
    mode: "visual",
    blindVoiceMode: true,
    speechRate: 1.25,
  };
}

function randomInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function pickWeightedOperation(
  operations: Operation[],
  weights?: Partial<Record<Operation, number>>,
): Operation {
  const active =
    operations.length > 0 ? operations : (["add", "sub", "mul", "div"] as Operation[]);
  if (!weights) {
    return active[Math.floor(Math.random() * active.length)];
  }
  const entries = active.map((op) => ({ op, weight: Math.max(0.1, weights[op] ?? 1) }));
  const total = entries.reduce((sum, item) => sum + item.weight, 0);
  let r = Math.random() * total;
  for (const item of entries) {
    r -= item.weight;
    if (r <= 0) return item.op;
  }
  return entries[entries.length - 1].op;
}

export function classifyPatternTag(op: Operation, a: number, b: number): string {
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const digitsA = String(absA).length;
  const digitsB = String(absB).length;

  if (op === "add") {
    const onesCarry = (absA % 10) + (absB % 10) >= 10;
    const tensCarry =
      Math.floor((absA % 100) / 10) +
        Math.floor((absB % 100) / 10) +
        (onesCarry ? 1 : 0) >=
      10;
    const prefix = `${Math.max(digitsA, digitsB)}d+${Math.min(digitsA, digitsB)}d`;
    return onesCarry || tensCarry ? `${prefix}_carry` : `${prefix}_clean`;
  }

  if (op === "sub") {
    if (a < b) return `${digitsA}d-${digitsB}d_negative`;
    const borrow =
      a % 10 < b % 10 || Math.floor((a % 100) / 10) < Math.floor((b % 100) / 10);
    return borrow ? `${Math.max(digitsA, digitsB)}d_borrow` : `${Math.max(digitsA, digitsB)}d_clean`;
  }

  if (op === "mul") {
    if (absB === 11 || absA === 11) return "mul_by_11";
    if (absB % 5 === 0 || absA % 5 === 0) return `${digitsA}d×${digitsB}d_mult5`;
    return `${Math.max(digitsA, digitsB)}d×${Math.min(digitsA, digitsB)}d`;
  }

  return `exact_div_${digitsB}d`;
}

export function formatProblemDisplay(op: Operation, a: number, b: number): string {
  return `${a} ${OP_SYMBOL[op]} ${b}`;
}

export function formatProblemSpoken(op: Operation, a: number, b: number): string {
  switch (op) {
    case "add":
      return `${a} plus ${b}`;
    case "sub":
      return `${a} minus ${b}`;
    case "mul":
      return `${a} times ${b}`;
    case "div":
      return `${a} divided by ${b}`;
  }
}

export function generateProblem(config: DrillConfig, excludeKey?: string): MathProblem {
  let attempt = 0;
  while (attempt < 12) {
    attempt += 1;
    const op = pickWeightedOperation(config.operations, config.operationWeights);
    let a = 0;
    let b = 0;
    let answer = 0;

    if (op === "add") {
      a = randomInt(config.ranges.add.minA, config.ranges.add.maxA);
      b = randomInt(config.ranges.add.minB, config.ranges.add.maxB);
      answer = a + b;
    } else if (op === "sub") {
      const rawA = randomInt(config.ranges.sub.minA, config.ranges.sub.maxA);
      const rawB = randomInt(config.ranges.sub.minB, config.ranges.sub.maxB);
      if (config.ranges.sub.allowNegative) {
        a = rawA;
        b = rawB;
        if (a === b) a += randomInt(3, 27);
      } else {
        a = Math.max(rawA, rawB);
        b = Math.min(rawA, rawB);
        if (a === b) a += randomInt(3, 27);
      }
      answer = a - b;
    } else if (op === "mul") {
      a = randomInt(config.ranges.mul.minA, config.ranges.mul.maxA);
      b = randomInt(config.ranges.mul.minB, config.ranges.mul.maxB);
      if (Math.random() < 0.5) {
        [a, b] = [b, a];
      }
      answer = a * b;
    } else {
      const divisor = Math.max(
        2,
        randomInt(config.ranges.div.minDivisor, config.ranges.div.maxDivisor),
      );
      const quotient = Math.max(
        2,
        randomInt(config.ranges.div.minQuotient, config.ranges.div.maxQuotient),
      );
      a = divisor * quotient;
      b = divisor;
      answer = quotient;
    }

    const key = `${op}:${a}:${b}`;
    if (key === excludeKey && attempt < 10) continue;

    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      op,
      a,
      b,
      answer,
      displayText: formatProblemDisplay(op, a, b),
      spokenText: formatProblemSpoken(op, a, b),
      patternTag: classifyPatternTag(op, a, b),
    };
  }

  return {
    id: `${Date.now().toString(36)}-fb`,
    op: "add",
    a: 154,
    b: 353,
    answer: 507,
    displayText: "154 + 353",
    spokenText: "154 plus 353",
    patternTag: "3d+3d_carry",
  };
}

export function generateSimilarProblem(
  op: Operation,
  a: number,
  b: number,
): MathProblem {
  const jitter = (n: number, minVal: number) => {
    const spread = Math.max(3, Math.round(n * 0.25));
    return Math.max(minVal, n + randomInt(-spread, spread));
  };

  let newA = a;
  let newB = b;
  let answer = 0;

  if (op === "add") {
    newA = jitter(a, 10);
    newB = jitter(b, 10);
    answer = newA + newB;
  } else if (op === "sub") {
    newA = jitter(a, 10);
    newB = jitter(b, 10);
    if (a >= b && newA <= newB) {
      newA = newB + randomInt(12, 95);
    } else if (a < b && newA >= newB) {
      newB = newA + randomInt(12, 95);
    }
    answer = newA - newB;
  } else if (op === "mul") {
    newA = jitter(a, 3);
    newB = jitter(b, 3);
    answer = newA * newB;
  } else {
    const origQ = Math.max(2, Math.round(a / Math.max(1, b)));
    newB = Math.max(2, jitter(b, 3));
    const q = Math.max(2, jitter(origQ, 3));
    newA = newB * q;
    answer = q;
  }

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    op,
    a: newA,
    b: newB,
    answer,
    displayText: formatProblemDisplay(op, newA, newB),
    spokenText: formatProblemSpoken(op, newA, newB),
    patternTag: classifyPatternTag(op, newA, newB),
  };
}

export function computeExpectedAnswer(op: Operation, a: number, b: number): number {
  switch (op) {
    case "add":
      return a + b;
    case "sub":
      return a - b;
    case "mul":
      return a * b;
    case "div":
      return b === 0 ? 0 : Math.trunc(a / b);
  }
}

function sameMultisetDigits(x: number, y: number): boolean {
  const sx = String(Math.abs(x)).split("").sort().join("");
  const sy = String(Math.abs(y)).split("").sort().join("");
  return sx.length >= 2 && sx === sy && x !== y;
}

export function classifyAttemptError(params: {
  status: AttemptStatus;
  correctAnswer: number;
  userAnswer: number | null;
  reactionMs: number;
  targetMs: number;
}): ErrorCategory {
  const { status, correctAnswer, userAnswer, reactionMs, targetMs } = params;
  if (status === "skipped") return "skipped";
  if (status === "timeout") return "timeout";
  if (status === "correct") {
    return reactionMs > targetMs ? "slow_solve" : "none";
  }
  if (userAnswer === null || Number.isNaN(userAnswer)) return "early_typo";
  if (userAnswer === -correctAnswer && correctAnswer !== 0) return "sign_error";

  const diff = Math.abs(userAnswer - correctAnswer);
  if (diff === 10 || diff === 100 || diff === 1000 || diff === 20 || diff === 200) {
    return "off_by_10_power";
  }
  if (diff <= 3) return "off_by_unit";
  if (sameMultisetDigits(userAnswer, correctAnswer)) return "digit_transposition";
  if (String(Math.abs(userAnswer)).length < String(Math.abs(correctAnswer)).length) {
    return "early_typo";
  }
  return "magnitude_error";
}

export function analyzeProblemTrick(
  op: Operation,
  a: number,
  b: number,
  answer: number,
): TrickAnalysis {
  if (op === "add") {
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    const roundTop = Math.ceil(small / 10) * 10;
    const comp = roundTop - small;
    if (comp > 0 && comp <= 3 && small >= 18) {
      const roundedStep = big + roundTop;
      return {
        strategyName: "Round & Compensate",
        steps: [
          `Notice ${small} is just ${comp} below ${roundTop}.`,
          `Add left-to-right: ${big} + ${roundTop} = ${roundedStep}.`,
          `Compensate by subtracting ${comp}: ${roundedStep} − ${comp} = ${answer}.`,
        ],
        shortcutTip:
          "Round operands ending in 7–9 up to the next ten/hundred, then subtract the small difference.",
        summary: `${big} + ${roundTop} − ${comp} = ${answer}`,
      };
    }

    const hundreds = Math.floor(small / 100) * 100;
    const tens = Math.floor((small % 100) / 10) * 10;
    const ones = small % 10;
    const steps: string[] = [];
    let acc = big;
    if (hundreds > 0) {
      steps.push(`Add hundreds first: ${acc} + ${hundreds} = ${acc + hundreds}`);
      acc += hundreds;
    }
    if (tens > 0) {
      steps.push(`Add tens next: ${acc} + ${tens} = ${acc + tens}`);
      acc += tens;
    }
    if (ones > 0 || steps.length === 0) {
      steps.push(`Finish with units: ${acc} + ${ones} = ${acc + ones}`);
    }
    if (a >= 100 && b >= 100) {
      const head = Math.floor(a / 10) * 10 + Math.floor(b / 10) * 10;
      const tail = (a % 10) + (b % 10);
      steps.push(
        `Alternative (front-end chunking): ${Math.floor(a / 10) * 10} + ${Math.floor(b / 10) * 10} = ${head}, plus (${a % 10} + ${b % 10} = ${tail}) → ${answer}.`,
      );
    }
    return {
      strategyName: "Left-to-Right Running Sum",
      steps,
      shortcutTip:
        "Always accumulate left-to-right (hundreds → tens → units) so you state or type leading digits without backtracking.",
      summary: `Left-to-right chunking → ${answer}`,
    };
  }

  if (op === "sub") {
    if (a < b) {
      const posGap = b - a;
      const bHundreds = Math.floor(a / 100) * 100;
      const bTens = Math.floor((a % 100) / 10) * 10;
      const bOnes = a % 10;
      const step1 = b - bHundreds;
      const step2 = step1 - bTens;
      return {
        strategyName: "Sign Flip + Left-to-Right Gap",
        steps: [
          `Since ${a} < ${b}, compute −(${b} − ${a}) instead of borrowing into negatives.`,
          `Subtract left-to-right: ${b}${bHundreds ? ` − ${bHundreds} = ${step1}` : ""}${bTens ? `, − ${bTens} = ${step2}` : ""}, − ${bOnes} = ${posGap}.`,
          `Re-apply negative sign: −${posGap}.`,
        ],
        shortcutTip:
          "Never subtract larger-from-smaller in your head. Reverse operands, find the positive distance, and prepend minus.",
        summary: `−(${b} − ${a}) = ${answer}`,
      };
    }

    const roundB = Math.ceil(b / 10) * 10;
    const comp = roundB - b;
    if (comp > 0 && comp <= 3 && b >= 15) {
      const mid = a - roundB;
      return {
        strategyName: "Round Up & Add Back",
        steps: [
          `Round ${b} up by ${comp} to ${roundB}.`,
          `Subtract clean number: ${a} − ${roundB} = ${mid}.`,
          `Add back the ${comp} over-subtracted: ${mid} + ${comp} = ${answer}.`,
        ],
        shortcutTip:
          "Eliminate borrowing by rounding the subtrahend up to the nearest 10/100 and adding back the cushion.",
        summary: `${a} − ${roundB} + ${comp} = ${answer}`,
      };
    }

    const hundreds = Math.floor(b / 100) * 100;
    const tens = Math.floor((b % 100) / 10) * 10;
    const ones = b % 10;
    const steps: string[] = [];
    let acc = a;
    if (hundreds > 0) {
      steps.push(`Subtract hundreds: ${acc} − ${hundreds} = ${acc - hundreds}`);
      acc -= hundreds;
    }
    if (tens > 0) {
      steps.push(`Subtract tens: ${acc} − ${tens} = ${acc - tens}`);
      acc -= tens;
    }
    if (ones > 0 || steps.length === 0) {
      steps.push(`Subtract units: ${acc} − ${ones} = ${acc - ones}`);
    }
    return {
      strategyName: "Sequential Left-to-Right Subtraction",
      steps,
      shortcutTip:
        "Peel off hundreds, then tens, then units; or count up from the smaller number to the next clean hundred.",
      summary: `${a} − ${b} step-down → ${answer}`,
    };
  }

  if (op === "mul") {
    if (a === 11 || b === 11) {
      const other = a === 11 ? b : a;
      if (other >= 10 && other <= 99) {
        const d1 = Math.floor(other / 10);
        const d2 = other % 10;
        const mid = d1 + d2;
        return {
          strategyName: "11× Sandwich Rule",
          steps: [
            `Split digits of ${other}: ${d1} and ${d2}.`,
            `Middle sum = ${d1} + ${d2} = ${mid}${mid >= 10 ? ` (carry 1 into ${d1} → ${d1 + 1})` : ""}.`,
            `Assemble digits → ${answer}.`,
          ],
          shortcutTip:
            "For any 2-digit × 11, sum the two digits and place between them (carrying 1 if sum ≥ 10).",
          summary: `${other} × 11 → ${answer}`,
        };
      }
    }

    if ((a + b) % 2 === 0 && Math.abs(a - b) <= 16 && a !== b) {
      const mid = (a + b) / 2;
      const diff = Math.abs(a - b) / 2;
      if (mid % 5 === 0 || mid <= 30) {
        return {
          strategyName: "Difference of Squares (m² − d²)",
          steps: [
            `Midpoint is ${mid}, distance is ${diff}: (${mid} − ${diff})(${mid} + ${diff}).`,
            `Square the midpoint: ${mid}² = ${mid * mid}.`,
            `Subtract ${diff}² (${diff * diff}): ${mid * mid} − ${diff * diff} = ${answer}.`,
          ],
          shortcutTip:
            "When two factors have the same parity and sit close together, use m² − d² (especially when m ends in 0 or 5).",
          summary: `${mid}² − ${diff}² = ${answer}`,
        };
      }
    }

    const roundA = Math.round(a / 10) * 10;
    const roundB = Math.round(b / 10) * 10;
    const deltaA = a - roundA;
    const deltaB = b - roundB;
    if ((Math.abs(deltaB) === 1 || Math.abs(deltaB) === 2) && b >= 18) {
      const base = a * roundB;
      const adj = a * Math.abs(deltaB);
      const sign = deltaB > 0 ? "+" : "−";
      return {
        strategyName: "Near-Multiple Anchor",
        steps: [
          `Anchor ${b} at ${roundB} (${b} = ${roundB} ${sign} ${Math.abs(deltaB)}).`,
          `Compute base: ${a} × ${roundB} = ${base}.`,
          `Adjust by ${Math.abs(deltaB)}×${a} (${adj}): ${base} ${sign} ${adj} = ${answer}.`,
        ],
        shortcutTip:
          "Multipliers ending in 8, 9, 1, or 2 are much faster via the nearest multiple of 10 plus/minus 1× or 2×.",
        summary: `${a}×${roundB} ${sign} ${adj} = ${answer}`,
      };
    }
    if ((Math.abs(deltaA) === 1 || Math.abs(deltaA) === 2) && a >= 18) {
      const base = b * roundA;
      const adj = b * Math.abs(deltaA);
      const sign = deltaA > 0 ? "+" : "−";
      return {
        strategyName: "Near-Multiple Anchor",
        steps: [
          `Anchor ${a} at ${roundA} (${a} = ${roundA} ${sign} ${Math.abs(deltaA)}).`,
          `Compute base: ${b} × ${roundA} = ${base}.`,
          `Adjust by ${Math.abs(deltaA)}×${b} (${adj}): ${base} ${sign} ${adj} = ${answer}.`,
        ],
        shortcutTip:
          "Always test whether either operand sits ±1 or ±2 away from a clean multiple of 10 or 100.",
        summary: `${b}×${roundA} ${sign} ${adj} = ${answer}`,
      };
    }

    if ((a % 2 === 0 && b % 5 === 0) || (b % 2 === 0 && a % 5 === 0)) {
      const even = a % 2 === 0 ? a : b;
      const five = a % 2 === 0 ? b : a;
      const halved = even / 2;
      const doubled = five * 2;
      return {
        strategyName: "Doubling & Halving",
        steps: [
          `Halve ${even} → ${halved}, and double ${five} → ${doubled}.`,
          `Multiply simpler pair: ${halved} × ${doubled} = ${answer}.`,
        ],
        shortcutTip:
          "Pairing an even number with a multiple of 5 creates an instant multiple of 10.",
        summary: `${halved} × ${doubled} = ${answer}`,
      };
    }

    const scoreSplit = (n: number) => (Math.floor(n / 10) % 10) + (n % 10);
    const [base, split] = scoreSplit(a) >= scoreSplit(b) ? [a, b] : [b, a];
    const tens = Math.floor(split / 10) * 10;
    const ones = split % 10;
    const part1 = base * tens;
    const part2 = base * ones;
    return {
      strategyName: "Distributive Left-to-Right Split",
      steps: [
        `Keep ${base} intact and split ${split} = ${tens} + ${ones}.`,
        `Major leg: ${base} × ${tens} = ${part1}.`,
        `Minor leg: ${base} × ${ones} = ${part2}.`,
        `Sum left-to-right: ${part1} + ${part2} = ${answer}.`,
      ],
      shortcutTip:
        "Never multiply right-to-left like paper arithmetic. Hold the larger partial product in working memory and add the units leg.",
      summary: `(${base}×${tens}) + (${base}×${ones}) = ${part1} + ${part2} = ${answer}`,
    };
  }

  const leadTens = Math.floor(answer / 10) * 10;
  const remUnits = answer % 10;
  if (leadTens > 0) {
    const chunk = b * leadTens;
    const remainder = a - chunk;
    return {
      strategyName: "Anchor Chunk + Remainder Peel",
      steps: [
        `Estimate leading tens: ${b} × ${leadTens} = ${chunk} (leaves ${a} − ${chunk} = ${remainder}).`,
        `Divide remainder: ${remainder} ÷ ${b} = ${remUnits}${[1, 3, 7, 9].includes(b % 10) ? ` (check units digit: ${b % 10} × ${remUnits} ends in ${(b * remUnits) % 10})` : ""}.`,
        `Combine quotient: ${leadTens} + ${remUnits} = ${answer}.`,
      ],
      shortcutTip:
        "Subtract the largest clean multiple of 10×divisor first, then use the units-digit signature on the remainder.",
      summary: `${b}×${leadTens} + ${b}×${remUnits} = ${a} → ${answer}`,
    };
  }

  return {
    strategyName: "Direct Factor Check",
    steps: [
      `Find k such that ${b} × k = ${a}.`,
      `Anchor ${b} × ${answer} = ${a}.`,
    ],
    shortcutTip:
      "Check benchmark multiples (5× and 10× divisor) to bracket single-digit or low-teen quotients immediately.",
    summary: `${b} × ${answer} = ${a}`,
  };
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export type VoiceParseResult =
  | { kind: "number"; value: number }
  | { kind: "command"; command: "skip" | "repeat" | "stop" }
  | { kind: "unknown" };

export function parseSpokenTranscript(transcript: string): VoiceParseResult {
  const cleaned = transcript
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/-/g, " ")
    .trim();

  if (!cleaned) return { kind: "unknown" };

  if (/\b(skip|pass|next)\b/.test(cleaned)) {
    return { kind: "command", command: "skip" };
  }
  if (/\b(repeat|again|pardon)\b/.test(cleaned)) {
    return { kind: "command", command: "repeat" };
  }
  if (/\b(stop|pause|finish|end)\b/.test(cleaned)) {
    return { kind: "command", command: "stop" };
  }

  const negativeHint = /\b(negative|minus)\b/.test(cleaned);
  const directDigits = cleaned
    .replace(/\b(negative|minus|equals|is|answer)\b/g, "")
    .trim();
  if (/^-?\d+$/.test(directDigits)) {
    const val = Number.parseInt(directDigits, 10);
    return { kind: "number", value: negativeHint && val > 0 ? -val : val };
  }

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t && !["and", "equals", "is", "answer", "the"].includes(t));

  let isNeg = false;
  const wordTokens: string[] = [];
  for (const t of tokens) {
    if (t === "negative" || t === "minus") {
      isNeg = true;
      continue;
    }
    if (/^\d+$/.test(t)) {
      const n = Number.parseInt(t, 10);
      if (wordTokens.length === 0 && tokens.filter((x) => /^\d+$/.test(x)).length === 1) {
        return { kind: "number", value: isNeg ? -n : n };
      }
    }
    wordTokens.push(t);
  }

  if (wordTokens.length === 0) return { kind: "unknown" };

  if (!wordTokens.includes("hundred") && !wordTokens.includes("thousand")) {
    const nums = wordTokens.map((t) =>
      /^\d+$/.test(t) ? Number.parseInt(t, 10) : NUMBER_WORDS[t],
    );
    if (nums.every((n) => n !== undefined)) {
      if (
        nums.length === 3 &&
        nums[0] >= 10 &&
        nums[0] <= 99 &&
        nums[1] >= 20 &&
        nums[1] % 10 === 0 &&
        nums[2] < 10
      ) {
        const val = nums[0] * 100 + nums[1] + nums[2];
        return { kind: "number", value: isNeg ? -val : val };
      }
      if (nums.length === 2 && nums[0] >= 10 && nums[0] <= 99 && nums[1] >= 10 && nums[1] <= 99) {
        const val = nums[0] * 100 + nums[1];
        return { kind: "number", value: isNeg ? -val : val };
      }
      if (nums.length === 3 && nums.every((n) => n >= 0 && n <= 9)) {
        const val = nums[0] * 100 + nums[1] * 10 + nums[2];
        return { kind: "number", value: isNeg ? -val : val };
      }
    }
  }

  let total = 0;
  let current = 0;
  let recognizedAny = false;

  for (const token of wordTokens) {
    if (/^\d+$/.test(token)) {
      current += Number.parseInt(token, 10);
      recognizedAny = true;
      continue;
    }
    const val = NUMBER_WORDS[token];
    if (val !== undefined) {
      current += val;
      recognizedAny = true;
    } else if (token === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      recognizedAny = true;
    } else if (token === "thousand") {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      recognizedAny = true;
    } else if (token === "million") {
      total += (current === 0 ? 1 : current) * 1_000_000;
      current = 0;
      recognizedAny = true;
    }
  }

  if (!recognizedAny) return { kind: "unknown" };
  const result = total + current;
  return { kind: "number", value: isNeg ? -result : result };
}
