import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Operation } from "@/lib/math";
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

  const sp = request.nextUrl.searchParams;
  const issueRaw = sp.get("issueFilter") ?? "issues";
  const issueFilter =
    issueRaw === "all" ||
    issueRaw === "issues" ||
    issueRaw === "wrong" ||
    issueRaw === "skipped_timeout" ||
    issueRaw === "slow"
      ? issueRaw
      : "issues";

  const opRaw = sp.get("op") ?? "all";
  const op = isValidOp(opRaw) ? opRaw : "all";

  const modeRaw = sp.get("mode") ?? "all";
  const mode = modeRaw === "visual" || modeRaw === "voice" ? modeRaw : "all";

  const sessionId = sp.get("sessionId") || undefined;
  const limitRaw = Number(sp.get("limit") ?? 150);

  const attempts = await getStore().getAttempts({
    issueFilter,
    op,
    mode,
    sessionId,
    limit: Number.isFinite(limitRaw) ? limitRaw : 150,
  });

  return NextResponse.json({ attempts });
}
