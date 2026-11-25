import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  analyzeProblemTrick,
  computeExpectedAnswer,
  ERROR_CATEGORY_LABEL,
  formatProblemDisplay,
  OP_LABEL,
  type AttemptRecord,
  type CoachProvider,
  type Operation,
  type OverviewStats,
  type RecommendedDrill,
  type WeaknessProfile,
} from "@/lib/math";
import type { DeskMathStore } from "./store";

export interface AskCoachParams {
  question: string;
  focusAttemptId?: string | null;
}

export interface CoachReply {
  content: string;
  provider: CoachProvider;
  modelUsed: string | null;
  recommendedDrill: RecommendedDrill | null;
}

function parseInlineExpression(
  text: string,
): { op: Operation; a: number; b: number } | null {
  const normalized = text
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-");
  const match = normalized.match(/\b(\d{1,5})\s*([+\-*/xX])\s*(\d{1,5})\b/);
  if (!match) return null;
  const a = Number.parseInt(match[1], 10);
  const b = Number.parseInt(match[3], 10);
  const rawOp = match[2].toLowerCase();
  const op: Operation =
    rawOp === "+" ? "add" : rawOp === "-" ? "sub" : rawOp === "/" ? "div" : "mul";
  if (op === "div" && (b === 0 || a % b !== 0)) return null;
  return { op, a, b };
}

function diagnoseMistakeNarrative(attempt: AttemptRecord): string {
  const label = ERROR_CATEGORY_LABEL[attempt.errorCategory];
  const problem = formatProblemDisplay(attempt.op, attempt.a, attempt.b);
  const trick = analyzeProblemTrick(
    attempt.op,
    attempt.a,
    attempt.b,
    attempt.correctAnswer,
  );

  const lines: string[] = [];
  if (attempt.status === "wrong") {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** (you entered \`${attempt.userAnswer ?? "—"}\` in ${(attempt.reactionMs / 1000).toFixed(2)}s).`,
    );
    lines.push(`Diagnosis: **${label}**.`);

    if (attempt.errorCategory === "off_by_10_power" && attempt.userAnswer !== null) {
      const diff = attempt.userAnswer - attempt.correctAnswer;
      lines.push(
        `Your answer was off by ${diff > 0 ? `+${diff}` : diff}. Rehearse the intermediate hundreds/tens subtotal mentally before touching the units digit.`,
      );
    } else if (attempt.errorCategory === "off_by_unit") {
      lines.push(
        `Magnitude was right and missed only by a small units adjustment. Verify the units-digit signature (${attempt.op === "mul" ? `${attempt.a % 10} × ${attempt.b % 10} ends in ${(attempt.a * attempt.b) % 10}` : "ones column"}) before submitting.`,
      );
    } else if (attempt.errorCategory === "sign_error") {
      lines.push(
        `Magnitude was exact, sign inverted. Lock the negative sign first whenever the left operand is smaller than the right.`,
      );
    }
  } else if (attempt.status === "skipped" || attempt.status === "timeout") {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** (${attempt.status} at ${(attempt.reactionMs / 1000).toFixed(2)}s).`,
    );
  } else {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** — solved accurately, but took **${(attempt.reactionMs / 1000).toFixed(2)}s** (slow process speed).`,
    );
  }

  lines.push(`\n**Fastest Method — ${trick.strategyName}:**`);
  for (const step of trick.steps) {
    lines.push(`- ${step}`);
  }
  lines.push(`*Quant Tip:* ${trick.shortcutTip}`);
  return lines.join("\n");
}

export function buildBuiltinCoachReply(
  question: string,
  overview: OverviewStats,
  weakness: WeaknessProfile,
  recentIssues: AttemptRecord[],
  focusAttempt: AttemptRecord | null,
): CoachReply {
  const qLower = question.toLowerCase();
  const inlineExpr = parseInlineExpression(question);

  if (focusAttempt) {
    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: diagnoseMistakeNarrative(focusAttempt),
      recommendedDrill: {
        label: `Drill ${OP_LABEL[focusAttempt.op]} Speed`,
        preset: "custom",
        operations: [focusAttempt.op],
        mode: focusAttempt.mode,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  if (inlineExpr) {
    const ans = computeExpectedAnswer(inlineExpr.op, inlineExpr.a, inlineExpr.b);
    const trick = analyzeProblemTrick(inlineExpr.op, inlineExpr.a, inlineExpr.b, ans);
    const display = formatProblemDisplay(inlineExpr.op, inlineExpr.a, inlineExpr.b);
    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: [
        `Here is the fastest quant-desk breakdown for **${display} = ${ans}** using **${trick.strategyName}**:`,
        ...trick.steps.map((s) => `- ${s}`),
        `\n*Speed Habit:* ${trick.shortcutTip}`,
      ].join("\n"),
      recommendedDrill: {
        label: `Practice ${OP_LABEL[inlineExpr.op]}`,
        preset: "custom",
        operations: [inlineExpr.op],
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  if (/\b(voice|audio|speak|listen|hear|mic|speech)\b/.test(qLower)) {
    const visual = overview.modeStats.find((m) => m.bucket === "visual");
    const voice = overview.modeStats.find((m) => m.bucket === "voice");
    const voiceLine =
      voice && voice.total > 0
        ? `Your Voice mode averages **${(voice.meanMs / 1000).toFixed(2)}s** total (${voice.meanProcessingMs !== null ? `${(voice.meanProcessingMs / 1000).toFixed(2)}s post-speech processing` : "post-speech not split"}) at **${voice.accuracyPct}%** accuracy${visual && visual.total > 0 ? ` vs **${(visual.meanMs / 1000).toFixed(2)}s** in Visual mode` : ""}.`
        : "Log a quick Voice drill first so we can measure your exact auditory retention gap.";

    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: [
        "**Voice Mode Speed Strategy (Auditory Working Memory)**",
        voiceLine,
        "- **Chunk while the prompt finishes:** For `154 + 353`, compute `154 + 300 = 454` the instant you hear \"three hundred\", before \"fifty-three\" finishes.",
        "- **Use Audio-Prompt + Keys first:** Train auditory memory with zero speech-recognition lag at `1.25×–1.5×` rate, then use Hands-Free Voice on iPhone/PC.",
        "- **Anchor partial products verbally:** In `56 × 23`, hold `1120` as \"eleven-twenty\" before adding `168`.",
      ].join("\n"),
      recommendedDrill: {
        label: "Launch 15Q Voice Weakness Drill",
        preset: "weakness_drill",
        operations: weakness.priorityOps,
        mode: "voice_keys",
        operationWeights: weakness.weights,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  if (/\b(plan|routine|schedule|drill|practice|next|today|recommend)\b/.test(qLower)) {
    const topOps = weakness.priorityOps.map((op) => OP_LABEL[op]).join(" & ");
    const recentNote =
      recentIssues.length > 0
        ? `Your recent history shows **${recentIssues.length}** flagged attempts (top cause: **${ERROR_CATEGORY_LABEL[recentIssues[0].errorCategory]}**).`
        : "Complete a 25-question Desk Pro calibration first to personalize operation weights.";

    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: [
        "**Recommended 6-Minute Quant Desk Drill Plan**",
        recentNote,
        "1. **2 min — Rapid Warmup (Visual):** Activate left-to-right scanning above 25+ Q/min.",
        `2. **2 min — Weakness Targeted (${topOps}):** Focus on your slowest/missed operations.`,
        "3. **2 min — Voice Blind Sprint (Audio + Keys):** Train auditory retention at `1.3×` speech rate.",
      ].join("\n"),
      recommendedDrill: {
        label: `Start ${topOps} Weakness Drill`,
        preset: "weakness_drill",
        operations: weakness.priorityOps.length > 0 ? weakness.priorityOps : ["mul", "div"],
        operationWeights: weakness.weights,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  if (overview.totalAttempts === 0) {
    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: [
        "**No Sessions Logged Yet — Ready to Benchmark**",
        "Run a **Desk Pro (25 Q)** or **Zetamac 120s Sprint** first (Visual or Voice). Once complete:",
        "- Every mistake, skip, timeout, and slow solve is categorized with an algorithmic shortcut.",
        "- Ask about any expression (e.g. *\"How do I calculate 56×23 faster?\"*) or connect **Google Gemini** in Settings for deep personalized coaching.",
      ].join("\n"),
      recommendedDrill: {
        label: "Start Calibration Sprint",
        preset: "weakness_drill",
        operations: ["add", "sub", "mul", "div"],
        targetMs: 3500,
      },
    };
  }

  const slowestOp = [...overview.opStats]
    .filter((o) => o.total > 0)
    .sort((a, b) => b.meanMs - a.meanMs)[0];
  const lowestAccOp = [...overview.opStats]
    .filter((o) => o.total > 0)
    .sort((a, b) => a.accuracyPct - b.accuracyPct)[0];

  const lines: string[] = [
    `**Quant Performance Diagnosis (${overview.totalAttempts} attempts across ${overview.totalSessions} sessions)**`,
    `- **Overall Pace:** ${(overview.overallMeanMs / 1000).toFixed(2)}s avg reaction | **${overview.overallAccuracyPct}%** accuracy | Peak: **${overview.bestPpm} Q/min**.`,
  ];
  if (slowestOp) {
    lines.push(
      `- **Primary Speed Bottleneck:** **${OP_LABEL[slowestOp.op]}** averages **${(slowestOp.meanMs / 1000).toFixed(2)}s** (p90: ${(slowestOp.p90Ms / 1000).toFixed(2)}s, ${slowestOp.slowCorrect} slow solves).`,
    );
  }
  if (lowestAccOp && lowestAccOp.accuracyPct < 98) {
    lines.push(
      `- **Accuracy Leakage:** **${OP_LABEL[lowestAccOp.op]}** is at **${lowestAccOp.accuracyPct}%** (${lowestAccOp.wrong} wrong, ${lowestAccOp.skippedOrTimeout} skipped/timeout).`,
    );
  }
  if (overview.errorBreakdown.length > 0) {
    const topErrors = overview.errorBreakdown
      .slice(0, 2)
      .map((e) => `${ERROR_CATEGORY_LABEL[e.category]} (${e.count})`)
      .join(", ");
    lines.push(`- **Recurring Mistake Patterns:** ${topErrors}.`);
  }

  return {
    provider: "builtin",
    modelUsed: "deterministic-quant-engine",
    content: lines.join("\n"),
    recommendedDrill: {
      label: `Fix ${weakness.priorityOps.map((o) => OP_LABEL[o]).join(" & ")} Bottleneck`,
      preset: "weakness_drill",
      operations: weakness.priorityOps.length > 0 ? weakness.priorityOps : ["mul", "div"],
      operationWeights: weakness.weights,
      targetMs: weakness.recommendedConfig.targetMs,
    },
  };
}

function shouldUsePrimaryModel(question: string, hasFocusAttempt: boolean): boolean {
  if (hasFocusAttempt) return false;
  return /\b(plan|diagnos|bottleneck|analyz|routine|compar|pattern|overall|week)\b/i.test(
    question,
  );
}

export async function askQuantCoach(
  store: DeskMathStore,
  params: AskCoachParams,
): Promise<CoachReply> {
  const [overview, weakness, recentIssues, geminiCfg, focusAttempt] =
    await Promise.all([
      store.getOverviewStats(),
      store.getWeaknessProfile(),
      store.getAttempts({ issueFilter: "issues", limit: 10 }),
      store.getEffectiveGeminiConfig(),
      params.focusAttemptId
        ? store.getAttemptById(params.focusAttemptId)
        : Promise.resolve(null),
    ]);

  const builtin = buildBuiltinCoachReply(
    params.question,
    overview,
    weakness,
    recentIssues,
    focusAttempt,
  );

  const allowFallback = process.env.ALLOW_LOCAL_AI_FALLBACK !== "false";

  if (geminiCfg.provider === "builtin" || !geminiCfg.apiKey) {
    return builtin;
  }

  const chosenModel = shouldUsePrimaryModel(
    params.question,
    Boolean(focusAttempt),
  )
    ? geminiCfg.primaryModel
    : geminiCfg.liteModel;

  const telemetryContext = {
    totalSessions: overview.totalSessions,
    totalAttempts: overview.totalAttempts,
    overallAccuracyPct: overview.overallAccuracyPct,
    overallMeanMs: overview.overallMeanMs,
    bestPpm: overview.bestPpm,
    opStats: overview.opStats,
    modeStats: overview.modeStats,
    errorBreakdown: overview.errorBreakdown.slice(0, 5),
    recentIssues: recentIssues.slice(0, 6).map((r) => ({
      problem: formatProblemDisplay(r.op, r.a, r.b),
      correctAnswer: r.correctAnswer,
      userAnswer: r.userAnswer,
      status: r.status,
      reactionMs: r.reactionMs,
      mode: r.mode,
      errorCategory: r.errorCategory,
      trickSummary: r.trickSummary,
    })),
    focusAttempt: focusAttempt
      ? {
          problem: formatProblemDisplay(
            focusAttempt.op,
            focusAttempt.a,
            focusAttempt.b,
          ),
          correctAnswer: focusAttempt.correctAnswer,
          userAnswer: focusAttempt.userAnswer,
          status: focusAttempt.status,
          reactionMs: focusAttempt.reactionMs,
          errorCategory: focusAttempt.errorCategory,
          trickSummary: focusAttempt.trickSummary,
        }
      : null,
  };

  try {
    const ai = new GoogleGenAI({ apiKey: geminiCfg.apiKey });
    const response = await ai.models.generateContent({
      model: chosenModel,
      contents: `Trader Telemetry JSON:\n${JSON.stringify(telemetryContext, null, 2)}\n\nTrader Question:\n${params.question}`,
      config: {
        systemInstruction:
          "You are an elite quantitative trading mental-math coach (Optiver/Jane Street/SIG desk style). Give concise, concrete, left-to-right arithmetic strategies and speed drills grounded strictly in the trader telemetry JSON. Always verify intermediate arithmetic accurately. Format cleanly with markdown bullets.",
        temperature: 0.3,
        maxOutputTokens: 600,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    return {
      provider: "gemini",
      modelUsed: chosenModel,
      content: text,
      recommendedDrill: builtin.recommendedDrill,
    };
  } catch (err) {
    if (!allowFallback) {
      throw err;
    }
    const reason = err instanceof Error ? err.message : "Gemini API call failed";
    return {
      provider: "builtin",
      modelUsed: "deterministic-quant-engine",
      content: `*Gemini fallback note (${reason.slice(0, 120)}): using deterministic Quant Coach engine.*\n\n${builtin.content}`,
      recommendedDrill: builtin.recommendedDrill,
    };
  }
}

export async function testGeminiConnection(params: {
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; message: string }> {
  const key = params.apiKey.trim();
  if (!key) return { ok: false, message: "Gemini API key is empty." };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: params.model || "gemini-2.5-flash-lite",
      contents: "Reply with exact word: READY",
      config: { maxOutputTokens: 20, temperature: 0 },
    });
    const text = res.text?.trim() ?? "OK";
    return {
      ok: true,
      message: `Connected to Google Gemini (${params.model}): ${text.slice(0, 32)}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Gemini connection failed.",
    };
  }
}

export async function getOrSynthesizeCloudTts(
  store: DeskMathStore,
  text: string,
  speakingRate: number,
): Promise<{ mediaPath: string } | null> {
  const clampedRate = Math.min(2.2, Math.max(0.7, Number(speakingRate.toFixed(2))));
  const voiceName = process.env.GCP_TTS_VOICE ?? "en-US-Neural2-D";
  const hash = createHash("sha256")
    .update(`${voiceName}:${clampedRate}:${text}`)
    .digest("hex")
    .slice(0, 24);
  const mediaPath = `tts/${hash}.mp3`;

  const cached = await store.readMedia(mediaPath);
  if (cached) {
    return { mediaPath };
  }

  // Synthesize via Google Cloud Text-to-Speech API using ADC on Cloud Run or GOOGLE_TTS_API_KEY
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const token = tokenRes.token;
    if (!token) return null;

    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: voiceName },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: clampedRate,
        },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return null;

    const audioBuffer = Buffer.from(data.audioContent, "base64");
    await store.writeMedia(mediaPath, audioBuffer, "audio/mpeg");
    return { mediaPath };
  } catch {
    return null;
  }
}
