import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import {
  analyzeProblemTrick,
  classifyAttemptError,
  createDefaultDrillConfig,
  generateProblem,
  parseSpokenTranscript,
} from '../../shared/math.js';
import { createApp } from '../src/app.js';
import { QuantDatabase } from '../src/db.js';

test('problem generator produces exact integers for all four operations', () => {
  const config = createDefaultDrillConfig();
  for (let i = 0; i < 200; i += 1) {
    const p = generateProblem(config);
    assert.ok(Number.isInteger(p.a));
    assert.ok(Number.isInteger(p.b));
    assert.ok(Number.isInteger(p.answer));
    if (p.op === 'div') {
      assert.equal(p.a % p.b, 0);
      assert.equal(p.a / p.b, p.answer);
    }
    if (p.op === 'sub' && !config.ranges.sub.allowNegative) {
      assert.ok(p.answer >= 0);
    }
  }
});

test('trick analyzer builds concrete mental steps for 154+353 and 56*23', () => {
  const addTrick = analyzeProblemTrick('add', 154, 353, 507);
  assert.equal(addTrick.strategyName, 'Left-to-Right Running Sum');
  assert.ok(addTrick.steps.some((s) => s.includes('507')));

  const mulTrick = analyzeProblemTrick('mul', 56, 23, 1288);
  assert.equal(mulTrick.strategyName, 'Distributive Left-to-Right Split');
  assert.ok(mulTrick.summary.includes('1120') && mulTrick.summary.includes('168'));

  const divTrick = analyzeProblemTrick('div', 1288, 23, 56);
  assert.equal(divTrick.strategyName, 'Anchor Chunk + Remainder Peel');
  assert.ok(divTrick.steps.some((s) => s.includes('1150')));
});

test('error classifier and spoken transcript parser handle quant cases', () => {
  assert.equal(
    classifyAttemptError({
      status: 'wrong',
      correctAnswer: 507,
      userAnswer: 407,
      reactionMs: 1800,
      targetMs: 3000,
    }),
    'off_by_10_power',
  );
  assert.equal(
    classifyAttemptError({
      status: 'correct',
      correctAnswer: 1288,
      userAnswer: 1288,
      reactionMs: 4200,
      targetMs: 3000,
    }),
    'slow_solve',
  );

  assert.deepEqual(parseSpokenTranscript('five hundred and seven'), { kind: 'number', value: 507 });
  assert.deepEqual(parseSpokenTranscript('twelve eighty eight'), { kind: 'number', value: 1288 });
  assert.deepEqual(parseSpokenTranscript('negative forty two'), { kind: 'number', value: -42 });
  assert.deepEqual(parseSpokenTranscript('skip please'), { kind: 'command', command: 'skip' });
});

test('REST API persists sessions, computes mistakes, coaches, and masks API keys', async () => {
  const db = new QuantDatabase(':memory:');
  const app = createApp(db);
  const server = app.listen(0);

  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { ok: boolean };
    assert.equal(health.ok, true);

    // Save a session with one fast correct, one slow correct, and one wrong carry error
    const createRes = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'voice_keys',
        preset: 'desk_pro',
        format: 'fixed',
        submissionMode: 'enter',
        questionLimit: 3,
        targetMs: 3000,
        operations: ['add', 'mul', 'div'],
        allowNegative: false,
        elapsedMs: 12000,
        attempts: [
          {
            seq: 1,
            op: 'add',
            a: 154,
            b: 353,
            userAnswer: 507,
            status: 'correct',
            mode: 'voice_keys',
            reactionMs: 1850,
            processingMs: 920,
          },
          {
            seq: 2,
            op: 'mul',
            a: 56,
            b: 23,
            userAnswer: 1188,
            status: 'wrong',
            mode: 'voice_keys',
            reactionMs: 3900,
            processingMs: 2800,
          },
          {
            seq: 3,
            op: 'div',
            a: 1288,
            b: 23,
            userAnswer: 56,
            status: 'correct',
            mode: 'voice_keys',
            reactionMs: 4100,
            processingMs: 3100,
          },
        ],
      }),
    });

    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      session: { id: string; correctCount: number; wrongCount: number; slowCorrectCount: number };
      attempts: Array<{ id: string; errorCategory: string }>;
    };
    assert.equal(created.session.correctCount, 2);
    assert.equal(created.session.wrongCount, 1);
    assert.equal(created.session.slowCorrectCount, 1);
    assert.equal(created.attempts[1].errorCategory, 'off_by_10_power');

    // Filter issues
    const issuesRes = await fetch(`${base}/api/attempts?issueFilter=issues`);
    const issuesBody = (await issuesRes.json()) as { attempts: Array<{ id: string; status: string }> };
    assert.equal(issuesBody.attempts.length, 2);

    // Mark wrong attempt reviewed
    const wrongId = created.attempts[1].id;
    const patchRes = await fetch(`${base}/api/attempts/${wrongId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewed: true, note: 'Hold 1120 clearly before adding 168' }),
    });
    assert.equal(patchRes.status, 200);
    const patched = (await patchRes.json()) as { attempt: { reviewed: boolean; note: string } };
    assert.equal(patched.attempt.reviewed, true);
    assert.match(patched.attempt.note, /1120/);

    // Ask coach about this mistake
    const coachRes = await fetch(`${base}/api/coach/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Why did I miss 56*23 and how do I improve?',
        focusAttemptId: wrongId,
      }),
    });
    assert.equal(coachRes.status, 200);
    const coachBody = (await coachRes.json()) as {
      assistantMessage: { content: string; provider: string; recommendedDrill: { operations: string[] } | null };
    };
    assert.equal(coachBody.assistantMessage.provider, 'builtin');
    assert.match(coachBody.assistantMessage.content, /1288/);
    assert.ok(coachBody.assistantMessage.recommendedDrill);

    // Settings API key masking
    const putSettings = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiProvider: 'openai', aiApiKey: 'sk-test-secret-9876' }),
    });
    assert.equal(putSettings.status, 200);
    const settingsJson = (await putSettings.json()) as { hasApiKey: boolean; maskedApiKey: string };
    assert.equal(settingsJson.hasApiKey, true);
    assert.equal(settingsJson.maskedApiKey, 'sk-••••9876');
  } finally {
    server.close();
    db.close();
  }
});
