import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }
  const messages = await getStore().getCoachMessages(60);
  return NextResponse.json({ messages });
}

export async function DELETE(request: Request) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }
  await getStore().clearCoachMessages();
  return NextResponse.json({ ok: true });
}
