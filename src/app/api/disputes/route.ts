import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { disputeSchema } from "@/lib/validators";
import { ForbiddenError } from "@/lib/errors";
import { transitionBooking } from "@/lib/bookings";

export async function GET() {
  try {
    const session = await requireSession();
    const disputes = await prisma.dispute.findMany({
      where: session.role === "ADMIN" ? {} : { openedById: session.id },
      include: { booking: true, openedBy: true },
      orderBy: { createdAt: "desc" },
    });
    return json({ disputes });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = disputeSchema.parse(await request.json());
    const booking = await prisma.booking.findUnique({
      where: { id: body.bookingId },
      include: { barber: true },
    });
    if (!booking) throw new ForbiddenError();
    if (booking.customerId !== session.id && booking.barber.userId !== session.id && session.role !== "ADMIN") {
      throw new ForbiddenError();
    }
    const dispute = await prisma.dispute.create({
      data: {
        bookingId: body.bookingId,
        openedById: session.id,
        reason: body.reason,
        description: body.description,
        evidence: body.evidence,
      },
    });
    await transitionBooking({
      bookingId: booking.id,
      actorId: session.id,
      actorRole: session.role,
      action: "dispute",
    }).catch(() => null);
    return json({ dispute }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
