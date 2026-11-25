import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Operation, SaveSessionInput } from "@/lib/math";
import { verifyApiRequest } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

function isValidOp(value: unknown): value is Operation {
  return value === "add" || value === "sub" || value === "mul" || value === "div";
}

export async function GET(request: NextRequest) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 30);
  const sessions = await getStore().getSessions(
    Number.isFinite(limitRaw) ? limitRaw : 30,
  );
  return NextResponse.json({ sessions });
}

export async function POST(request: NextRequest) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const body = (await request.json().catch(() => null)) as
    | Partial<SaveSessionInput>
    | null;
  if (!body || !Array.isArray(body.attempts) || body.attempts.length === 0) {
    return NextResponse.json(
      { error: "Session must contain at least one attempt." },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: "No valid integer attempts provided." },
      { status: 400 },
    );
  }

  const payload: SaveSessionInput = {
    mode: body.mode ?? "visual",
    preset: String(body.preset ?? "custom"),
    format: String(body.format ?? "fixed"),
    submissionMode: String(body.submissionMode ?? "enter"),
    durationLimitSec: body.durationLimitSec ?? null,
    questionLimit: body.questionLimit ?? null,
    targetMs: Number.isFinite(body.targetMs) ? Number(body.targetMs) : 3500,
    operations:
      Array.isArray(body.operations) && body.operations.length > 0
        ? body.operations.filter(isValidOp)
        : ["add", "sub", "mul", "div"],
    allowNegative: Boolean(body.allowNegative),
    elapsedMs: Number.isFinite(body.elapsedMs) ? Number(body.elapsedMs) : 1000,
    attempts: validAttempts,
  };

  const result = await getStore().saveSessionWithAttempts(payload);
  return NextResponse.json(result, { status: 201 });
}
