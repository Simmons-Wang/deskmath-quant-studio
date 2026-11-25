import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }
  const settings = await getStore().getSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Missing settings body" }, { status: 400 });
  }

  const updated = await getStore().updateSettings({
    targetMs: typeof body.targetMs === "number" ? body.targetMs : undefined,
    speechRate: typeof body.speechRate === "number" ? body.speechRate : undefined,
    voiceName: typeof body.voiceName === "string" ? body.voiceName : undefined,
    soundEnabled:
      typeof body.soundEnabled === "boolean" ? body.soundEnabled : undefined,
    cloudTtsEnabled:
      typeof body.cloudTtsEnabled === "boolean"
        ? body.cloudTtsEnabled
        : undefined,
    aiProvider:
      body.aiProvider === "builtin" || body.aiProvider === "gemini"
        ? body.aiProvider
        : undefined,
    geminiPrimaryModel:
      typeof body.geminiPrimaryModel === "string"
        ? body.geminiPrimaryModel
        : undefined,
    geminiLiteModel:
      typeof body.geminiLiteModel === "string"
        ? body.geminiLiteModel
        : undefined,
    geminiApiKey:
      body.geminiApiKey === null || typeof body.geminiApiKey === "string"
        ? body.geminiApiKey
        : undefined,
  });

  return NextResponse.json(updated);
}
