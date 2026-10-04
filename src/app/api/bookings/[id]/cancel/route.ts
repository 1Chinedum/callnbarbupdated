import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { transitionBooking } from "@/lib/bookings";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const booking = await transitionBooking({
      bookingId: id,
      actorId: session.id,
      actorRole: session.role,
      action: "cancel",
      reason: body.reason,
    });
    return json({ booking });
  } catch (e) {
    return errorResponse(e);
  }
}
