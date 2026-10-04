import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { transitionBooking } from "@/lib/bookings";
import { AppError } from "@/lib/errors";

const ACTIONS = ["accept", "reject", "on_the_way", "arrived", "start", "complete"] as const;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const body = await request.json();
    const action = body.action as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) throw new AppError("Unknown action.");
    const booking = await transitionBooking({
      bookingId: id,
      actorId: session.id,
      actorRole: session.role,
      action,
      reason: body.reason,
    });
    return json({ booking });
  } catch (e) {
    return errorResponse(e);
  }
}
