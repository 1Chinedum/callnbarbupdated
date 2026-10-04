import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { initializePayment } from "@/lib/paystack";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("CUSTOMER");
    const { bookingId } = await request.json();
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.customerId !== session.id) throw new ForbiddenError();
    const init = await initializePayment(booking.id, session.email);
    return json(init);
  } catch (e) {
    return errorResponse(e);
  }
}
