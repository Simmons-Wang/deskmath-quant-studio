import {
  analyzeProblemTrick,
  computeExpectedAnswer,
  ERROR_CATEGORY_LABEL,
  formatProblemDisplay,
  OP_LABEL,
  type Operation,
} from '../../shared/math.js';
import type {
  AttemptRecord,
  OverviewStats,
  QuantDatabase,
  RecommendedDrill,
  WeaknessProfile,
} from './db.js';

export interface AskCoachParams {
  question: string;
  focusAttemptId?: string | null;
  transientProvider?: 'builtin' | 'openai' | 'gemini';
  transientModel?: string;
  transientApiKey?: string;
}

export interface CoachReply {
  content: string;
  provider: 'builtin' | 'openai' | 'gemini';
  recommendedDrill: RecommendedDrill | null;
}

function parseInlineExpression(text: string): { op: Operation; a: number; b: number } | null {
  const normalized = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const match = normalized.match(/\b(\d{1,5})\s*([+\-*/xX])\s*(\d{1,5})\b/);
  if (!match) return null;
  const a = Number.parseInt(match[1], 10);
  const b = Number.parseInt(match[3], 10);
  const rawOp = match[2].toLowerCase();
  const op: Operation =
    rawOp === '+' ? 'add' : rawOp === '-' ? 'sub' : rawOp === '/' ? 'div' : 'mul';
  if (op === 'div' && (b === 0 || a % b !== 0)) return null;
  return { op, a, b };
}

function diagnoseMistakeNarrative(attempt: AttemptRecord): string {
  const label = ERROR_CATEGORY_LABEL[attempt.errorCategory];
  const problem = formatProblemDisplay(attempt.op, attempt.a, attempt.b);
  const trick = analyzeProblemTrick(attempt.op, attempt.a, attempt.b, attempt.correctAnswer);

  const lines: string[] = [];
  if (attempt.status === 'wrong') {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** (you entered \`${attempt.userAnswer ?? '—'}\` in ${(attempt.reactionMs / 1000).toFixed(2)}s).`,
    );
    lines.push(`Diagnosis: **${label}**.`);

    if (attempt.errorCategory === 'off_by_10_power' && attempt.userAnswer !== null) {
      const diff = attempt.userAnswer - attempt.correctAnswer;
      lines.push(
        `Your answer was off by ${diff > 0 ? `+${diff}` : diff}. That almost always happens when carrying or holding the intermediate partial sum in working memory—say the running subtotal out loud mentally before touching the units digit.`,
      );
    } else if (attempt.errorCategory === 'off_by_unit') {
      lines.push(
        `You had the magnitude right and missed only by a small units adjustment. Double-check the last digit signature (${attempt.op === 'mul' ? `${attempt.a % 10} × ${attempt.b % 10} ends in ${(attempt.a * attempt.b) % 10}` : 'ones column'}) before submitting.`,
      );
    } else if (attempt.errorCategory === 'sign_error') {
      lines.push(
        `Magnitude was exact, sign flipped. For negative subtraction, lock the sign first whenever the left operand is smaller than the right.`,
      );
    }
  } else if (attempt.status === 'skipped' || attempt.status === 'timeout') {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** (${attempt.status} at ${(attempt.reactionMs / 1000).toFixed(2)}s).`,
    );
  } else {
    lines.push(
      `Problem: **${problem} = ${attempt.correctAnswer}** — solved correctly, but took **${(attempt.reactionMs / 1000).toFixed(2)}s** (slow process speed).`,
    );
  }

  lines.push(`\n**Fastest Method — ${trick.strategyName}:**`);
  for (const step of trick.steps) {
    lines.push(`- ${step}`);
  }
  lines.push(`*Quant Tip:* ${trick.shortcutTip}`);
  return lines.join('\n');
}

function buildBuiltinCoachReply(
  question: string,
  overview: OverviewStats,
  weakness: WeaknessProfile,
  recentIssues: AttemptRecord[],
  focusAttempt: AttemptRecord | null,
): CoachReply {
  const qLower = question.toLowerCase();
  const inlineExpr = parseInlineExpression(question);

  // 1. Focus attempt review
  if (focusAttempt) {
    const narrative = diagnoseMistakeNarrative(focusAttempt);
    return {
      provider: 'builtin',
      content: narrative,
      recommendedDrill: {
        label: `Drill ${OP_LABEL[focusAttempt.op]} Speed`,
        preset: 'custom',
        operations: [focusAttempt.op],
        mode: focusAttempt.mode,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  // 2. User asked about a specific inline problem like "56*23" or "154+353"
  if (inlineExpr) {
    const ans = computeExpectedAnswer(inlineExpr.op, inlineExpr.a, inlineExpr.b);
    const trick = analyzeProblemTrick(inlineExpr.op, inlineExpr.a, inlineExpr.b, ans);
    const display = formatProblemDisplay(inlineExpr.op, inlineExpr.a, inlineExpr.b);
    const content = [
      `Here is the fastest quant-desk breakdown for **${display} = ${ans}** using **${trick.strategyName}**:`,
      ...trick.steps.map((s) => `- ${s}`),
      `\n*Speed Habit:* ${trick.shortcutTip}`,
    ].join('\n');

    return {
      provider: 'builtin',
      content,
      recommendedDrill: {
        label: `Practice ${OP_LABEL[inlineExpr.op]}`,
        preset: 'custom',
        operations: [inlineExpr.op],
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  // 3. Voice mode coaching
  if (/\b(voice|audio|speak|listen|hear|mic|speech)\b/.test(qLower)) {
    const visual = overview.modeStats.find((m) => m.bucket === 'visual');
    const voice = overview.modeStats.find((m) => m.bucket === 'voice');
    const voiceLine =
      voice && voice.total > 0
        ? `Your Voice mode averages **${(voice.meanMs / 1000).toFixed(2)}s** total (${voice.meanProcessingMs !== null ? `${(voice.meanProcessingMs / 1000).toFixed(2)}s post-speech processing` : 'post-speech not split'}) at **${voice.accuracyPct}%** accuracy${visual && visual.total > 0 ? ` vs **${(visual.meanMs / 1000).toFixed(2)}s** in Visual mode` : ''}.`
        : `You haven't logged enough Voice mode attempts yet to benchmark your auditory gap.`;

    return {
      provider: 'builtin',
      content: [
        `**Voice Mode Speed Strategy (Auditory Working Memory)**`,
        voiceLine,
        `- **Chunk while the prompt finishes:** For \`154 + 353\`, add \`154 + 300 = 454\` in your head the moment you hear "three hundred", before "fifty-three" finishes.`,
        `- **Use Audio-Prompt + Keyboard first:** Speaking answers aloud adds ~500–900ms speech-recognition lag; train auditory recall with keyboard auto-submit at \`1.3x–1.5x\` speech rate, then graduate to Hands-Free Voice.`,
        `- **Rehearse partial products verbally (sub-vocally):** In \`56 × 23\`, lock \`1120\` cleanly as "eleven-twenty" so it doesn't decay while computing \`168\`.`,
      ].join('\n'),
      recommendedDrill: {
        label: 'Launch 15Q Voice Weakness Drill',
        preset: 'weakness_drill',
        operations: weakness.priorityOps,
        mode: 'voice_keys',
        operationWeights: weakness.weights,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  // 4. Plan / routine / drill recommendation
  if (/\b(plan|routine|schedule|drill|practice|next|today|recommend)\b/.test(qLower)) {
    const topOps = weakness.priorityOps.map((op) => OP_LABEL[op]).join(' & ');
    const recentNote =
      recentIssues.length > 0
        ? `Your latest session flagged **${recentIssues.length}** mistakes/slow solves (most common: **${ERROR_CATEGORY_LABEL[recentIssues[0].errorCategory]}**).`
        : `Complete one 25-question Desk Pro calibration first so weights lock onto your true bottlenecks.`;

    return {
      provider: 'builtin',
      content: [
        `**Recommended 6-Minute Quant Desk Drill Plan**`,
        recentNote,
        `1. **2 min — Rapid Warmup (Visual):** Activate left-to-right scanning and push throughput above 25+ problems/min.`,
        `2. **2 min — Weakness Targeted (${topOps}):** Focus exclusively on your slowest/highest-error ops (${weakness.bullets[0] ?? '2×2 multiplication & 3-digit carries'}).`,
        `3. **2 min — Voice Blind Sprint (Audio + Keys):** Train pure auditory retention at \`1.3x\` speech speed without looking at the numbers.`,
        `\nClick below to start your weighted **${topOps}** drill immediately.`,
      ].join('\n'),
      recommendedDrill: {
        label: `Start ${topOps} Weakness Drill`,
        preset: 'weakness_drill',
        operations: weakness.priorityOps.length > 0 ? weakness.priorityOps : ['mul', 'div'],
        operationWeights: weakness.weights,
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  // 5. Multiplication / division / subtraction / addition specific question
  if (/\b(mult|times|2x2|2×2|product)\b/.test(qLower)) {
    return {
      provider: 'builtin',
      content: [
        `**Fast 2×2 Integer Multiplication Playbook (e.g. 56 × 23)**`,
        `- **Default Left-to-Right Split:** Break the cleaner operand into tens + units: \`56 × 20 = 1120\`, \`56 × 3 = 168\`, add \`1120 + 168 = 1288\`.`,
        `- **Near-10 Anchor:** For \`56 × 29\`, use \`56 × 30 − 56 = 1680 − 56 = 1624\` instead of multiplying by 9.`,
        `- **Difference of Squares:** When midpoint is clean (e.g. \`27 × 23\`), compute \`25² − 2² = 625 − 4 = 621\`.`,
        `- **Doubling & Halving:** For \`36 × 15\`, convert to \`18 × 30 = 540\`.`,
      ].join('\n'),
      recommendedDrill: {
        label: 'Drill Multiplication Speed',
        preset: 'custom',
        operations: ['mul'],
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  if (/\b(div|division|quotient)\b/.test(qLower)) {
    return {
      provider: 'builtin',
      content: [
        `**Exact Integer Division Playbook (e.g. 1288 ÷ 23)**`,
        `- **Step 1 — Bracket the tens digit:** \`23 × 50 = 1150\` (and \`23 × 60 = 1380\`, too big), so the answer is in the \`50s\`.`,
        `- **Step 2 — Peel the remainder:** \`1288 − 1150 = 138\`.`,
        `- **Step 3 — Units-digit signature:** Divisor \`23\` ends in \`3\`; \`3 × 6 = 18\` ends in \`8\`, matching \`138\` → **56**.`,
      ].join('\n'),
      recommendedDrill: {
        label: 'Drill Exact Division',
        preset: 'custom',
        operations: ['div'],
        targetMs: weakness.recommendedConfig.targetMs,
      },
    };
  }

  // 6. Default holistic telemetry diagnosis ("Analyze my biggest speed bottleneck", "Review my mistakes", etc.)
  if (overview.totalAttempts === 0) {
    return {
      provider: 'builtin',
      content: [
        `**No Sessions Logged Yet — Ready to Benchmark**`,
        `Run a quick **Desk Pro (25 Q)** or **Zetamac 120s Sprint** first (or try **Voice: Audio + Keys**). Once you finish:`,
        `- Every wrong answer, skip, timeout, and slow solve gets logged with a mistake category (carry slip, sign flip, transposition, etc.).`,
        `- You can click any mistake row to see its exact mental shortcut, or ask me something like *"How do I calculate 56×23 faster?"*.`,
      ].join('\n'),
      recommendedDrill: {
        label: 'Start Calibration Sprint',
        preset: 'weakness_drill',
        operations: ['add', 'sub', 'mul', 'div'],
        targetMs: 3500,
      },
    };
  }

  const sortedOps = [...overview.opStats]
    .filter((o) => o.total > 0)
    .sort((a, b) => b.meanMs - a.meanMs);
  const slowestOp = sortedOps[0];
  const lowestAccOp = [...overview.opStats]
    .filter((o) => o.total > 0)
    .sort((a, b) => a.accuracyPct - b.accuracyPct)[0];

  const lines: string[] = [
    `**Quant Performance Diagnosis (${overview.totalAttempts} attempts across ${overview.totalSessions} sessions)**`,
    `- **Overall Pace:** ${(overview.overallMeanMs / 1000).toFixed(2)}s avg reaction time | **${overview.overallAccuracyPct}%** accuracy | Best throughput: **${overview.bestPpm} Q/min**.`,
  ];

  if (slowestOp) {
    lines.push(
      `- **Primary Speed Bottleneck:** **${OP_LABEL[slowestOp.op]}** averages **${(slowestOp.meanMs / 1000).toFixed(2)}s** (p90: ${(slowestOp.p90Ms / 1000).toFixed(2)}s, ${slowestOp.slowCorrect} slow solves).`,
    );
  }
  if (lowestAccOp && lowestAccOp.accuracyPct < 98) {
    lines.push(
      `- **Accuracy Leakage:** **${OP_LABEL[lowestAccOp.op]}** has **${lowestAccOp.accuracyPct}%** accuracy (${lowestAccOp.wrong} wrong, ${lowestAccOp.skippedOrTimeout} skipped/timeout).`,
    );
  }
  if (overview.errorBreakdown.length > 0) {
    const topErrors = overview.errorBreakdown
      .slice(0, 2)
      .map((e) => `${ERROR_CATEGORY_LABEL[e.category]} (${e.count})`)
      .join(', ');
    lines.push(`- **Recurring Mistake Patterns:** ${topErrors}.`);
  }
  if (recentIssues.length > 0) {
    const sample = recentIssues[0];
    const trick = analyzeProblemTrick(sample.op, sample.a, sample.b, sample.correctAnswer);
    lines.push(
      `- **Latest Flagged Item:** \`${formatProblemDisplay(sample.op, sample.a, sample.b)} = ${sample.correctAnswer}\` (${(sample.reactionMs / 1000).toFixed(2)}s) → *${trick.strategyName}*: ${trick.summary}.`,
    );
  }

  return {
    provider: 'builtin',
    content: lines.join('\n'),
    recommendedDrill: {
      label: `Fix ${weakness.priorityOps.map((o) => OP_LABEL[o]).join(' & ')} Bottleneck`,
      preset: 'weakness_drill',
      operations: weakness.priorityOps.length > 0 ? weakness.priorityOps : ['mul', 'div'],
      operationWeights: weakness.weights,
      targetMs: weakness.recommendedConfig.targetMs,
    },
  };
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.35,
        max_tokens: 550,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI returned empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  const chosenModel = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 600 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Gemini returned empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function askQuantCoach(
  db: QuantDatabase,
  params: AskCoachParams,
): Promise<CoachReply> {
  const overview = db.getOverviewStats();
  const weakness = db.getWeaknessProfile();
  const recentIssues = db.getAttempts({ issueFilter: 'issues', limit: 10 });
  const focusAttempt = params.focusAttemptId
    ? db.getAttemptById(params.focusAttemptId)
    : null;

  const builtin = buildBuiltinCoachReply(
    params.question,
    overview,
    weakness,
    recentIssues,
    focusAttempt,
  );

  const savedAi = db.getRawAiConfig();
  const provider = params.transientProvider ?? savedAi.provider;
  const model = params.transientModel ?? savedAi.model;
  const apiKey = (params.transientApiKey ?? savedAi.apiKey).trim();

  if (provider === 'builtin' || !apiKey) {
    return builtin;
  }

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
          problem: formatProblemDisplay(focusAttempt.op, focusAttempt.a, focusAttempt.b),
          correctAnswer: focusAttempt.correctAnswer,
          userAnswer: focusAttempt.userAnswer,
          status: focusAttempt.status,
          reactionMs: focusAttempt.reactionMs,
          errorCategory: focusAttempt.errorCategory,
          trickSummary: focusAttempt.trickSummary,
        }
      : null,
  };

  const systemPrompt = [
    'You are an elite quantitative trading mental-math coach (Optiver/Jane Street/SIG style).',
    'Give ultra-concise, concrete, left-to-right arithmetic strategies and speed drills grounded strictly in the user telemetry JSON.',
    'Always compute intermediate numbers accurately. Keep formatting clean in markdown bullets.',
  ].join(' ');

  const userPrompt = `User Telemetry:\n${JSON.stringify(telemetryContext, null, 2)}\n\nTrader Question:\n${params.question}`;

  try {
    const content =
      provider === 'openai'
        ? await callOpenAI(apiKey, model, systemPrompt, userPrompt)
        : await callGemini(apiKey, model, systemPrompt, userPrompt);

    return {
      provider,
      content,
      recommendedDrill: builtin.recommendedDrill,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'External AI call failed';
    return {
      provider: 'builtin',
      content: `*Note: External ${provider} call failed (${reason}). Showing built-in Quant Coach analysis instead.*\n\n${builtin.content}`,
      recommendedDrill: builtin.recommendedDrill,
    };
  }
}

export async function testAiConnection(params: {
  provider: 'openai' | 'gemini';
  model: string;
  apiKey: string;
}): Promise<{ ok: boolean; message: string }> {
  const key = params.apiKey.trim();
  if (!key) return { ok: false, message: 'API key is empty.' };
  try {
    if (params.provider === 'openai') {
      const reply = await callOpenAI(key, params.model || 'gpt-4o-mini', 'Reply with OK.', 'Ping');
      return { ok: true, message: `Connected to OpenAI (${reply.slice(0, 40)}).` };
    }
    const reply = await callGemini(key, params.model || 'gemini-2.5-flash', 'Reply with OK.', 'Ping');
    return { ok: true, message: `Connected to Gemini (${reply.slice(0, 40)}).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' };
  }
}
