import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeProblemTrick,
  classifyAttemptError,
  createDefaultDrillConfig,
  generateProblem,
  parseSpokenTranscript,
} from "../src/lib/math";
import { askQuantCoach } from "../src/lib/server/gemini";
import { LocalJsonStore } from "../src/lib/server/store";

async function run() {
  console.log("==> 1. Testing integer problem generator invariants...");
  const config = createDefaultDrillConfig();
  for (let i = 0; i < 250; i += 1) {
    const p = generateProblem(config);
    assert.ok(Number.isInteger(p.a));
    assert.ok(Number.isInteger(p.b));
    assert.ok(Number.isInteger(p.answer));
    if (p.op === "div") {
      assert.equal(p.a % p.b, 0);
      assert.equal(p.a / p.b, p.answer);
    }
    if (p.op === "sub" && !config.ranges.sub.allowNegative) {
      assert.ok(p.answer >= 0);
    }
  }

  console.log("==> 2. Testing mental math trick synthesizer...");
  const addTrick = analyzeProblemTrick("add", 154, 353, 507);
  assert.equal(addTrick.strategyName, "Left-to-Right Running Sum");
  assert.ok(addTrick.steps.some((s) => s.includes("507")));

  const mulTrick = analyzeProblemTrick("mul", 56, 23, 1288);
  assert.equal(mulTrick.strategyName, "Distributive Left-to-Right Split");
  assert.ok(
    mulTrick.summary.includes("1120") && mulTrick.summary.includes("168"),
  );

  const divTrick = analyzeProblemTrick("div", 1288, 23, 56);
  assert.equal(divTrick.strategyName, "Anchor Chunk + Remainder Peel");
  assert.ok(divTrick.steps.some((s) => s.includes("1150")));

  console.log("==> 3. Testing error taxonomy & spoken transcript parser...");
  assert.equal(
    classifyAttemptError({
      status: "wrong",
      correctAnswer: 507,
      userAnswer: 407,
      reactionMs: 1800,
      targetMs: 3000,
    }),
    "off_by_10_power",
  );
  assert.equal(
    classifyAttemptError({
      status: "correct",
      correctAnswer: 1288,
      userAnswer: 1288,
      reactionMs: 4200,
      targetMs: 3000,
    }),
    "slow_solve",
  );
  assert.deepEqual(parseSpokenTranscript("five hundred and seven"), {
    kind: "number",
    value: 507,
  });
  assert.deepEqual(parseSpokenTranscript("twelve eighty eight"), {
    kind: "number",
    value: 1288,
  });
  assert.deepEqual(parseSpokenTranscript("negative forty two"), {
    kind: "number",
    value: -42,
  });
  assert.deepEqual(parseSpokenTranscript("skip please"), {
    kind: "command",
    command: "skip",
  });

  console.log("==> 4. Testing dual-backend LocalJsonStore & Quant Coach...");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskmath-test-"));
  try {
    const store = new LocalJsonStore(tmpDir);
    const saved = await store.saveSessionWithAttempts({
      mode: "voice_keys",
      preset: "desk_pro",
      format: "fixed",
      submissionMode: "enter",
      questionLimit: 3,
      targetMs: 3000,
      operations: ["add", "mul", "div"],
      allowNegative: false,
      elapsedMs: 12000,
      attempts: [
        {
          seq: 1,
          op: "add",
          a: 154,
          b: 353,
          userAnswer: 507,
          status: "correct",
          mode: "voice_keys",
          reactionMs: 1850,
          processingMs: 920,
        },
        {
          seq: 2,
          op: "mul",
          a: 56,
          b: 23,
          userAnswer: 1188,
          status: "wrong",
          mode: "voice_keys",
          reactionMs: 3900,
          processingMs: 2800,
        },
        {
          seq: 3,
          op: "div",
          a: 1288,
          b: 23,
          userAnswer: 56,
          status: "correct",
          mode: "voice_keys",
          reactionMs: 4100,
          processingMs: 3100,
        },
      ],
    });

    assert.equal(saved.session.correctCount, 2);
    assert.equal(saved.session.wrongCount, 1);
    assert.equal(saved.session.slowCorrectCount, 1);
    assert.equal(saved.attempts[1].errorCategory, "off_by_10_power");

    const issues = await store.getAttempts({ issueFilter: "issues" });
    assert.equal(issues.length, 2);

    const updated = await store.updateAttempt(saved.attempts[1].id, {
      reviewed: true,
      note: "Anchor 1120 first",
    });
    assert.equal(updated?.reviewed, true);
    assert.equal(updated?.note, "Anchor 1120 first");

    const coachReply = await askQuantCoach(store, {
      question: "Why did I miss 56*23?",
      focusAttemptId: saved.attempts[1].id,
    });
    assert.match(coachReply.content, /1288/);
    assert.ok(coachReply.recommendedDrill);

    const updatedSettings = await store.updateSettings({
      aiProvider: "gemini",
      geminiApiKey: "AIzaSyTestSecretKey9876",
    });
    assert.equal(updatedSettings.hasApiKey, true);
    assert.equal(updatedSettings.maskedApiKey, "AIza••••9876");

    await store.writeMedia("tts/sample.mp3", Buffer.from("fake-mp3"), "audio/mpeg");
    const media = await store.readMedia("tts/sample.mp3");
    assert.equal(media?.contentType, "audio/mpeg");
    assert.equal(media?.buffer.toString(), "fake-mp3");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  console.log("ALL DOMAIN & STORAGE UNIT TESTS PASSED!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
