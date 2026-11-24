import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { type Operation } from '../../shared/math.js';
import { askQuantCoach, testAiConnection } from './coachEngine.js';
import { type QuantDatabase, type SaveSessionInput } from './db.js';

function isValidOp(value: unknown): value is Operation {
  return value === 'add' || value === 'sub' || value === 'mul' || value === 'div';
}

export function createApp(db: QuantDatabase, clientDistDir?: string): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, db: 'sqlite', timestamp: new Date().toISOString() });
  });

  app.get('/api/overview', (_req: Request, res: Response) => {
    res.json(db.getOverviewStats());
  });

  app.get('/api/weakness-profile', (_req: Request, res: Response) => {
    res.json(db.getWeaknessProfile());
  });

  app.get('/api/sessions', (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 30);
    res.json({ sessions: db.getSessions(Number.isFinite(limit) ? limit : 30) });
  });

  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const detail = db.getSessionDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(detail);
  });

  app.post('/api/sessions', (req: Request, res: Response) => {
    const body = req.body as Partial<SaveSessionInput> | undefined;
    if (!body || !Array.isArray(body.attempts) || body.attempts.length === 0) {
      res.status(400).json({ error: 'Session must contain at least one attempt.' });
      return;
    }

    const validAttempts = body.attempts.filter(
      (a) =>
        a &&
        isValidOp(a.op) &&
        Number.isInteger(a.a) &&
        Number.isInteger(a.b) &&
        Number.isFinite(a.reactionMs),
    );
    if (validAttempts.length === 0) {
      res.status(400).json({ error: 'No valid integer attempts provided.' });
      return;
    }

    const payload: SaveSessionInput = {
      mode: body.mode ?? 'visual',
      preset: String(body.preset ?? 'custom'),
      format: String(body.format ?? 'fixed'),
      submissionMode: String(body.submissionMode ?? 'enter'),
      durationLimitSec: body.durationLimitSec ?? null,
      questionLimit: body.questionLimit ?? null,
      targetMs: Number.isFinite(body.targetMs) ? Number(body.targetMs) : 3500,
      operations: Array.isArray(body.operations) && body.operations.length > 0
        ? body.operations.filter(isValidOp)
        : ['add', 'sub', 'mul', 'div'],
      allowNegative: Boolean(body.allowNegative),
      elapsedMs: Number.isFinite(body.elapsedMs) ? Number(body.elapsedMs) : 1000,
      attempts: validAttempts,
    };

    const result = db.saveSessionWithAttempts(payload);
    res.status(201).json(result);
  });

  app.get('/api/attempts', (req: Request, res: Response) => {
    const issueRaw = String(req.query.issueFilter ?? 'issues');
    const issueFilter =
      issueRaw === 'all' ||
      issueRaw === 'issues' ||
      issueRaw === 'wrong' ||
      issueRaw === 'skipped_timeout' ||
      issueRaw === 'slow'
        ? issueRaw
        : 'issues';

    const opRaw = String(req.query.op ?? 'all');
    const op = isValidOp(opRaw) ? opRaw : 'all';

    const modeRaw = String(req.query.mode ?? 'all');
    const mode = modeRaw === 'visual' || modeRaw === 'voice' ? modeRaw : 'all';

    const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
    const limit = Number(req.query.limit ?? 150);

    const attempts = db.getAttempts({
      issueFilter,
      op,
      mode,
      sessionId,
      limit: Number.isFinite(limit) ? limit : 150,
    });
    res.json({ attempts });
  });

  app.patch('/api/attempts/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = req.body as { reviewed?: boolean; note?: string | null } | undefined;
    if (!body) {
      res.status(400).json({ error: 'Missing patch body' });
      return;
    }
    const updated = db.updateAttempt(id, {
      reviewed: body.reviewed,
      note: body.note,
    });
    if (!updated) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }
    res.json({ attempt: updated });
  });

  app.get('/api/coach/messages', (_req: Request, res: Response) => {
    res.json({ messages: db.getCoachMessages(60) });
  });

  app.delete('/api/coach/messages', (_req: Request, res: Response) => {
    db.clearCoachMessages();
    res.json({ ok: true });
  });

  app.post('/api/coach/ask', async (req: Request, res: Response) => {
    const body = req.body as {
      question?: string;
      focusAttemptId?: string | null;
      transientProvider?: 'builtin' | 'openai' | 'gemini';
      transientModel?: string;
      transientApiKey?: string;
    } | undefined;

    const question = (body?.question ?? '').trim();
    if (!question) {
      res.status(400).json({ error: 'Question cannot be empty.' });
      return;
    }

    const userMsg = db.addCoachMessage({
      role: 'user',
      content: question,
      focusAttemptId: body?.focusAttemptId ?? null,
      provider: 'builtin',
      recommendedDrill: null,
    });

    const reply = await askQuantCoach(db, {
      question,
      focusAttemptId: body?.focusAttemptId ?? null,
      transientProvider: body?.transientProvider,
      transientModel: body?.transientModel,
      transientApiKey: body?.transientApiKey,
    });

    const assistantMsg = db.addCoachMessage({
      role: 'assistant',
      content: reply.content,
      focusAttemptId: body?.focusAttemptId ?? null,
      provider: reply.provider,
      recommendedDrill: reply.recommendedDrill,
    });

    res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
  });

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(db.getSettings());
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ error: 'Missing settings body' });
      return;
    }

    const updated = db.updateSettings({
      targetMs: typeof body.targetMs === 'number' ? body.targetMs : undefined,
      speechRate: typeof body.speechRate === 'number' ? body.speechRate : undefined,
      voiceName: typeof body.voiceName === 'string' ? body.voiceName : undefined,
      soundEnabled: typeof body.soundEnabled === 'boolean' ? body.soundEnabled : undefined,
      aiProvider:
        body.aiProvider === 'builtin' || body.aiProvider === 'openai' || body.aiProvider === 'gemini'
          ? body.aiProvider
          : undefined,
      aiModel: typeof body.aiModel === 'string' ? body.aiModel : undefined,
      aiApiKey:
        body.aiApiKey === null || typeof body.aiApiKey === 'string' ? body.aiApiKey : undefined,
    });

    res.json(updated);
  });

  app.post('/api/settings/test-ai', async (req: Request, res: Response) => {
    const body = req.body as {
      provider?: 'openai' | 'gemini';
      model?: string;
      apiKey?: string;
    } | undefined;

    const saved = db.getRawAiConfig();
    const provider =
      body?.provider === 'openai' || body?.provider === 'gemini'
        ? body.provider
        : saved.provider === 'builtin'
          ? 'openai'
          : saved.provider;
    const model = body?.model?.trim() || saved.model;
    const apiKey = body?.apiKey?.trim() || saved.apiKey;

    const result = await testAiConnection({ provider, model, apiKey });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get('/api/export', (_req: Request, res: Response) => {
    const payload = db.exportAllData();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="quant-math-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  });

  app.delete('/api/data', (_req: Request, res: Response) => {
    db.resetTrainingData();
    res.json({ ok: true });
  });

  if (clientDistDir && fs.existsSync(clientDistDir)) {
    app.use(
      express.static(clientDistDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
        },
      }),
    );
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  return app;
}
