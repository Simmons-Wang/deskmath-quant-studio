import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyApiRequest } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const caller = await verifyApiRequest(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  const mediaPath = request.nextUrl.searchParams.get("path") ?? "";
  if (!mediaPath) {
    return NextResponse.json({ error: "Missing media path" }, { status: 400 });
  }

  try {
    const payload = await getStore().readMedia(mediaPath);
    if (!payload) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(payload.buffer), {
      status: 200,
      headers: {
        "Content-Type": payload.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Invalid media path" }, { status: 400 });
  }
}
