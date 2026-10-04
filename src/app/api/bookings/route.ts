import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { bookingSchema } from "@/lib/validators";
import { createBooking } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";

function serialize(b: Awaited<ReturnType<typeof createBooking>>) {
  return {
    id: b.id,
    publicRef: b.publicRef,
    status: b.status,
    date: b.bookingDate,
    startTime: b.startTime,
    endTime: b.endTime,
    amountKobo: b.amountKobo,
    platformFeeKobo: b.platformFeeKobo,
    barberEarningKobo: b.barberEarningKobo,
    amount: formatMoney(b.amountKobo, b.currency),
    fee: formatMoney(b.platformFeeKobo, b.currency),
    total: formatMoney(b.amountKobo, b.currency),
    currency: b.currency,
    service: b.service,
    barber: { id: b.barber.id, name: b.barber.user.name },
    address: {
      address: b.address.address,
      city: b.address.city,
      state: b.address.state,
      landmark: b.address.landmark,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireRole("CUSTOMER", "BARBER", "ADMIN");
    const tab = request.nextUrl.searchParams.get("tab");
    const where =
      session.role === "CUSTOMER"
        ? { customerId: session.id }
        : session.role === "BARBER"
          ? { barber: { userId: session.id } }
          : {};
    const bookings = await prisma.booking.findMany({
      where: {
        ...where,
        ...(tab === "upcoming"
          ? { status: { in: ["BARBER_PENDING", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "VERIFIED"] } }
          : tab === "active"
            ? { status: { in: ["IN_PROGRESS", "ON_THE_WAY", "ARRIVED", "VERIFIED"] } }
            : tab === "completed"
              ? { status: "COMPLETED" }
              : tab === "cancelled"
                ? { status: { in: ["CANCELLED", "REFUNDED"] } }
                : {}),
      },
      include: {
        service: true,
        barber: { include: { user: true } },
        customer: true,
        address: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json({
      bookings: bookings.map((b) => ({
        id: b.id,
        publicRef: b.publicRef,
        status: b.status,
        date: b.bookingDate,
        startTime: b.startTime,
        amount: formatMoney(b.amountKobo, b.currency),
        earning: formatMoney(b.barberEarningKobo, b.currency),
        service: b.service.name,
        barberName: b.barber.user.name,
        customerName: b.customer.name,
        city: b.address.city,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("CUSTOMER");
    const body = bookingSchema.parse(await request.json());
    const booking = await createBooking({ ...body, customerId: session.id });
    return json({ booking: serialize(booking) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
