import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { verifyQr } from "@/lib/qr";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("BARBER");
    const body = await request.json();
    const result = await verifyQr({
      rawPayload: String(body.payload ?? ""),
      barberUserId: session.id,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return json({ ok: true, appointment: result });
  } catch (e) {
    return errorResponse(e);
  }
}
