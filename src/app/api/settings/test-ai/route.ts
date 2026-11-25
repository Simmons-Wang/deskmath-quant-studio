import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { testGeminiConnection } from "@/lib/server/gemini";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const body = (await request.json().catch(() => null)) as {
    model?: string;
    apiKey?: string;
  } | null;

  const saved = await getStore().getEffectiveGeminiConfig();
  const apiKey = body?.apiKey?.trim() || saved.apiKey;
  const model = body?.model?.trim() || saved.liteModel;

  const result = await testGeminiConnection({ apiKey, model });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
