import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { askQuantCoach } from "@/lib/server/gemini";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const body = (await request.json().catch(() => null)) as {
    question?: string;
    focusAttemptId?: string | null;
  } | null;

  const question = (body?.question ?? "").trim();
  if (!question) {
    return NextResponse.json(
      { error: "Question cannot be empty." },
      { status: 400 },
    );
  }

  const store = getStore();
  const userMessage = await store.addCoachMessage({
    role: "user",
    content: question,
    focusAttemptId: body?.focusAttemptId ?? null,
    provider: "builtin",
    modelUsed: null,
    recommendedDrill: null,
  });

  const reply = await askQuantCoach(store, {
    question,
    focusAttemptId: body?.focusAttemptId ?? null,
  });

  const assistantMessage = await store.addCoachMessage({
    role: "assistant",
    content: reply.content,
    focusAttemptId: body?.focusAttemptId ?? null,
    provider: reply.provider,
    modelUsed: reply.modelUsed,
    recommendedDrill: reply.recommendedDrill,
  });

  return NextResponse.json({ userMessage, assistantMessage });
}
