import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { getOrSynthesizeCloudTts } from "@/lib/server/gemini";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: string;
    rate?: number;
  } | null;
  const text = (body?.text ?? "").trim().slice(0, 140);
  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const rate = typeof body?.rate === "number" ? body.rate : 1.25;
  const synthesized = await getOrSynthesizeCloudTts(getStore(), text, rate);
  if (!synthesized) {
    return NextResponse.json({ available: false }, { status: 200 });
  }
  return NextResponse.json({
    available: true,
    mediaUrl: `/api/media?path=${encodeURIComponent(synthesized.mediaPath)}`,
  });
}
