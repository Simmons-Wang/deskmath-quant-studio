import { NextResponse } from "next/server";
import { isAuthRequired } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    ok: true,
    service: "deskmath-quant-studio",
    storageBackend: store.backend,
    authRequired: isAuthRequired(),
    timestamp: new Date().toISOString(),
  });
}
