import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const b = await prisma.booking.findUnique({
      where: { id },
      include: {
        service: true,
        barber: { include: { user: true } },
        customer: true,
        address: true,
        payments: true,
        review: true,
      },
    });
    if (!b) throw new NotFoundError("Booking not found.");
    const allowed =
      session.role === "ADMIN" ||
      b.customerId === session.id ||
      b.barber.userId === session.id;
    if (!allowed) throw new ForbiddenError();

    const showLocation = session.role === "ADMIN" || b.customerId === session.id || (b.barber.userId === session.id && ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "VERIFIED", "IN_PROGRESS", "COMPLETED"].includes(b.status));

    return json({
      booking: {
        id: b.id,
        publicRef: b.publicRef,
        status: b.status,
        date: b.bookingDate,
        startTime: b.startTime,
        endTime: b.endTime,
        amount: formatMoney(b.amountKobo, b.currency),
        fee: formatMoney(b.platformFeeKobo, b.currency),
        earning: formatMoney(b.barberEarningKobo, b.currency),
        amountKobo: b.amountKobo,
        service: b.service.name,
        durationMin: b.service.durationMin,
        barber: { id: b.barber.id, name: b.barber.user.name, photo: b.barber.user.profileImage },
        customer: { name: b.customer.name, phone: b.barber.userId === session.id || session.role === "ADMIN" ? b.customer.phone : undefined },
        location: showLocation
          ? {
              address: b.address.address,
              city: b.address.city,
              state: b.address.state,
              landmark: b.address.landmark,
              instructions: b.address.instructions,
              latitude: b.address.latitude,
              longitude: b.address.longitude,
            }
          : { city: b.address.city, state: b.address.state },
        paymentStatus: b.payments[0]?.status ?? "PENDING",
        hasReview: Boolean(b.review),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
