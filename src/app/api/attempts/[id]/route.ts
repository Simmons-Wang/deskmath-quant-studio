import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    reviewed?: boolean;
    note?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Missing patch body" }, { status: 400 });
  }

  const updated = await getStore().updateAttempt(id, {
    reviewed: body.reviewed,
    note: body.note,
  });
  if (!updated) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  return NextResponse.json({ attempt: updated });
}
