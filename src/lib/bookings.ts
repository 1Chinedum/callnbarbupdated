import { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { computeCommission } from "./money";
import { getNumberSetting, getSetting } from "./settings";
import { publicBookingRef, randomToken, hashToken, qrPayload } from "./crypto";
import { assertSlotFree } from "./slots";
import { addMinutes, bookingDateTime } from "./time";
import { notify } from "./notify";
import { creditServiceEarning } from "./wallet";

const PAID: BookingStatus[] = [
  "CONFIRMED",
  "BARBER_PENDING",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "VERIFIED",
  "IN_PROGRESS",
  "COMPLETED",
];

export async function createBooking(input: {
  customerId: string;
  barberId: string;
  serviceId: string;
  addressId: string;
  bookingDate: string;
  startTime: string;
}) {
  const [barber, service, address, customer] = await Promise.all([
    prisma.barberProfile.findUnique({
      where: { id: input.barberId },
      include: { user: true },
    }),
    prisma.barberService.findUnique({ where: { id: input.serviceId } }),
    prisma.address.findUnique({ where: { id: input.addressId } }),
    prisma.user.findUnique({ where: { id: input.customerId } }),
  ]);

  if (!customer) throw new NotFoundError("Customer not found.");
  if (!barber || barber.verificationStatus !== "VERIFIED" || !barber.user || barber.user.status !== "ACTIVE") {
    throw new AppError("This barber is not available for booking.");
  }
  if (!service || !service.active || service.barberId !== barber.id) {
    throw new AppError("This service is not available.");
  }
  if (!address || address.userId !== input.customerId) {
    throw new AppError("Please select a valid address.");
  }

  const endTime = await assertSlotFree({
    barberId: barber.id,
    dateISO: input.bookingDate,
    startTime: input.startTime,
    durationMin: service.durationMin,
  });

  const percent = await getNumberSetting("commission_percent");
  const fees = computeCommission(service.priceKobo, percent);
  const currency = (await getSetting("default_currency")) || "NGN";

  const booking = await prisma.booking.create({
    data: {
      publicRef: publicBookingRef(),
      customerId: input.customerId,
      barberId: barber.id,
      serviceId: service.id,
      addressId: address.id,
      bookingDate: input.bookingDate,
      startTime: input.startTime,
      endTime,
      amountKobo: service.priceKobo,
      platformFeeKobo: fees.platformFeeKobo,
      barberEarningKobo: fees.barberEarningKobo,
      currency,
      status: "PENDING_PAYMENT",
    },
    include: {
      service: true,
      barber: { include: { user: true } },
      address: true,
    },
  });

  await notify({
    userId: input.customerId,
    title: "Booking created",
    message: `Complete payment to confirm ${service.name} with ${barber.user.name}.`,
    type: "booking_created",
    data: { bookingId: booking.id },
  });

  return booking;
}

export async function confirmPaidBooking(bookingId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { qrTokens: true, barber: { include: { user: true } }, service: true },
  });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.status !== "PENDING_PAYMENT" && PAID.includes(booking.status)) {
    return booking;
  }

  const token = randomToken(24);
  await db.booking.update({
    where: { id: bookingId },
    data: { status: "BARBER_PENDING" },
  });
  if (!booking.qrTokens.some((t) => t.status === "ACTIVE")) {
    await db.qrToken.create({
      data: {
        bookingId,
        tokenHash: hashToken(token),
        status: "ACTIVE",
      },
    });
  }

  await notify({
    userId: booking.customerId,
    title: "Payment successful",
    message: "Your booking is confirmed. Waiting for your barber to accept.",
    type: "payment_successful",
    data: { bookingId },
  });
  await notify({
    userId: booking.barber.userId,
    title: "New booking request",
    message: `A customer booked ${booking.service.name} on ${booking.bookingDate} at ${booking.startTime}.`,
    type: "booking_request",
    data: { bookingId },
  });

  return { ...booking, _plainQrToken: token };
}

export async function issueQrPlainToken(bookingId: string) {
  const existing = await prisma.qrToken.findFirst({
    where: { bookingId, status: "ACTIVE" },
  });
  const token = randomToken(24);
  if (existing) {
    await prisma.qrToken.update({
      where: { id: existing.id },
      data: { tokenHash: hashToken(token) },
    });
  } else {
    await prisma.qrToken.create({
      data: { bookingId, tokenHash: hashToken(token), status: "ACTIVE" },
    });
  }
  return qrPayload(token);
}

export async function transitionBooking(params: {
  bookingId: string;
  actorId: string;
  actorRole: "CUSTOMER" | "BARBER" | "ADMIN";
  action:
    | "accept"
    | "reject"
    | "on_the_way"
    | "arrived"
    | "start"
    | "complete"
    | "cancel"
    | "dispute";
  reason?: string;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      barber: { include: { user: true, wallet: true } },
      service: true,
      customer: true,
    },
  });
  if (!booking) throw new NotFoundError("Booking not found.");

  const isBarber = params.actorRole === "BARBER" && booking.barber.userId === params.actorId;
  const isCustomer = params.actorRole === "CUSTOMER" && booking.customerId === params.actorId;
  const isAdmin = params.actorRole === "ADMIN";
  if (!isBarber && !isCustomer && !isAdmin) throw new ForbiddenError();

  const next = nextStatus(booking.status, params.action, params.actorRole);
  if (!next) {
    throw new AppError("This booking cannot be updated from its current status.");
  }

  if (params.action === "complete") {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await tx.barberProfile.update({
        where: { id: booking.barberId },
        data: { completedJobs: { increment: 1 } },
      });
      await creditServiceEarning(tx, {
        barberId: booking.barberId,
        bookingId: booking.id,
        earningKobo: booking.barberEarningKobo,
        feeKobo: booking.platformFeeKobo,
      });
    });
    await notify({
      userId: booking.customerId,
      title: "Service completed",
      message: "How was your cut? Leave a review for your barber.",
      type: "service_completed",
      data: { bookingId: booking.id },
    });
    await notify({
      userId: booking.barber.userId,
      title: "Earnings credited",
      message: "Your wallet has been updated for the completed appointment.",
      type: "earnings_credited",
      data: { bookingId: booking.id },
    });
    return prisma.booking.findUnique({ where: { id: booking.id } });
  }

  const extra: Record<string, unknown> = { status: next };
  if (params.action === "start") extra.startedAt = new Date();
  if (params.action === "cancel" || params.action === "reject") {
    extra.cancelReason = params.reason ?? params.action;
    extra.cancelledById = params.actorId;
    extra.cancelledAt = new Date();
    await prisma.qrToken.updateMany({
      where: { bookingId: booking.id, status: "ACTIVE" },
      data: { status: "INVALIDATED" },
    });
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: extra,
  });

  if (params.action === "accept") {
    await notify({
      userId: booking.customerId,
      title: "Barber accepted",
      message: `${booking.barber.user.name} accepted your appointment.`,
      type: "barber_accepted",
      data: { bookingId: booking.id },
    });
  }
  if (params.action === "reject") {
    await notify({
      userId: booking.customerId,
      title: "Barber unavailable",
      message: "The barber could not take this appointment. You may be eligible for a refund.",
      type: "barber_rejected",
      data: { bookingId: booking.id },
    });
  }
  if (params.action === "on_the_way") {
    await notify({
      userId: booking.customerId,
      title: "Barber on the way",
      message: "Your barber is heading to your location.",
      type: "on_the_way",
      data: { bookingId: booking.id },
    });
  }
  if (params.action === "arrived") {
    await notify({
      userId: booking.customerId,
      title: "Barber arrived",
      message: "Show your appointment QR code to verify.",
      type: "arrived",
      data: { bookingId: booking.id },
    });
  }
  if (params.action === "cancel") {
    const otherId = isCustomer ? booking.barber.userId : booking.customerId;
    await notify({
      userId: otherId,
      title: "Booking cancelled",
      message: params.reason ?? "The appointment was cancelled.",
      type: "cancelled",
      data: { bookingId: booking.id },
    });
  }

  return updated;
}

function nextStatus(
  current: BookingStatus,
  action: string,
  role: string,
): BookingStatus | null {
  const map: Record<string, Partial<Record<string, BookingStatus>>> = {
    accept: { BARBER_PENDING: "ACCEPTED" },
    reject: { BARBER_PENDING: "CANCELLED" },
    on_the_way: { ACCEPTED: "ON_THE_WAY" },
    arrived: { ON_THE_WAY: "ARRIVED", ACCEPTED: "ARRIVED" },
    start: { VERIFIED: "IN_PROGRESS" },
    complete: { IN_PROGRESS: "COMPLETED" },
    dispute: {
      ACCEPTED: "DISPUTED",
      ON_THE_WAY: "DISPUTED",
      ARRIVED: "DISPUTED",
      VERIFIED: "DISPUTED",
      IN_PROGRESS: "DISPUTED",
      COMPLETED: "DISPUTED",
    },
    cancel: {
      PENDING_PAYMENT: "CANCELLED",
      CONFIRMED: "CANCELLED",
      BARBER_PENDING: "CANCELLED",
      ACCEPTED: "CANCELLED",
    },
  };
  if (action === "cancel" && role === "ADMIN") {
    return "CANCELLED";
  }
  return map[action]?.[current] ?? null;
}

export { addMinutes, bookingDateTime };
