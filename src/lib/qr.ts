import { prisma } from "./prisma";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { hashToken, parseQrPayload } from "./crypto";
import { notify } from "./notify";
import { bookingDateTime } from "./time";

const VERIFY_WINDOW_HOURS = 6;

export async function verifyQr(params: {
  rawPayload: string;
  barberUserId: string;
  userAgent?: string;
}) {
  const plain = parseQrPayload(params.rawPayload);
  if (!plain) {
    throw new AppError("This appointment QR code is invalid or has already been used.");
  }
  const tokenHash = hashToken(plain);

  const token = await prisma.qrToken.findUnique({
    where: { tokenHash },
    include: {
      booking: {
        include: {
          barber: { include: { user: true } },
          customer: true,
          service: true,
          address: true,
          payments: true,
        },
      },
    },
  });

  const fail = async (bookingId: string | null, reason: string) => {
    if (bookingId) {
      await prisma.qrScan.create({
        data: {
          bookingId,
          qrTokenId: token?.id,
          barberUserId: params.barberUserId,
          success: false,
          reason,
          userAgent: params.userAgent,
        },
      });
    }
    throw new AppError(reason);
  };

  if (!token) {
    throw new AppError("This appointment QR code is invalid or has already been used.");
  }

  const booking = token.booking;
  if (booking.barber.userId !== params.barberUserId) {
    await fail(booking.id, "This appointment does not belong to you.");
  }
  const paid = booking.payments.some((p) => p.status === "SUCCESSFUL" && p.verified);
  if (!paid && !["BARBER_PENDING", "ACCEPTED", "ON_THE_WAY", "ARRIVED"].includes(booking.status)) {
    await fail(booking.id, "This appointment is not paid.");
  }
  if (booking.status === "CANCELLED" || token.status === "INVALIDATED") {
    await fail(booking.id, "This appointment QR code is invalid or has already been used.");
  }
  if (token.status === "USED" || token.usedAt || booking.verifiedAt) {
    await fail(booking.id, "This appointment QR code is invalid or has already been used.");
  }
  if (["COMPLETED", "REFUNDED"].includes(booking.status)) {
    await fail(booking.id, "This appointment has already been completed.");
  }

  const start = bookingDateTime(booking.bookingDate, booking.startTime);
  const windowMs = VERIFY_WINDOW_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  if (now < start.getTime() - windowMs || now > start.getTime() + windowMs) {
    await fail(booking.id, "This appointment is outside the allowed verification window.");
  }

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.qrToken.findUnique({ where: { id: token.id } });
    if (!fresh || fresh.status !== "ACTIVE" || fresh.usedAt) {
      throw new AppError("This appointment QR code is invalid or has already been used.");
    }
    await tx.qrToken.update({
      where: { id: token.id },
      data: { status: "USED", usedAt: new Date() },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    await tx.qrScan.create({
      data: {
        bookingId: booking.id,
        qrTokenId: token.id,
        barberUserId: params.barberUserId,
        success: true,
        reason: "verified",
        userAgent: params.userAgent,
      },
    });
  });

  await notify({
    userId: booking.customerId,
    title: "Appointment verified",
    message: "Your barber verified the appointment QR code.",
    type: "verified",
    data: { bookingId: booking.id },
  });
  await notify({
    userId: booking.barber.userId,
    title: "QR verification",
    message: "Appointment verified. You can start the service.",
    type: "qr_verified",
    data: { bookingId: booking.id },
  });

  return {
    bookingId: booking.id,
    publicRef: booking.publicRef,
    customerName: booking.customer.name,
    service: booking.service.name,
    date: booking.bookingDate,
    time: booking.startTime,
    location: `${booking.address.address}, ${booking.address.city}`,
    status: "VERIFIED",
  };
}

export async function requireBarberProfile(userId: string) {
  const profile = await prisma.barberProfile.findUnique({ where: { userId } });
  if (!profile) throw new ForbiddenError("Barber profile required.");
  return profile;
}

export { NotFoundError };
