import { BookingStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { addMinutes, dayOfWeek, fromMinutes, overlaps, toMinutes } from "./time";
import { AppError } from "./errors";

const BLOCKING: BookingStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "BARBER_PENDING",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "VERIFIED",
  "IN_PROGRESS",
];

export async function getAvailableSlots(barberId: string, dateISO: string) {
  const barber = await prisma.barberProfile.findUnique({
    where: { id: barberId },
    include: { availability: true, blockedDates: true },
  });
  if (!barber) throw new AppError("Barber not found.", 404);

  if (barber.blockedDates.some((d) => d.date === dateISO)) {
    return [];
  }

  const dow = dayOfWeek(dateISO);
  const hours = barber.availability.find((a) => a.dayOfWeek === dow && a.active);
  if (!hours) return [];

  const slot = barber.slotMinutes;
  const bookings = await prisma.booking.findMany({
    where: { barberId, bookingDate: dateISO, status: { in: BLOCKING } },
  });

  const slots: string[] = [];
  let cursor = toMinutes(hours.startTime);
  const end = toMinutes(hours.endTime);
  const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
  const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;

  while (cursor + slot <= end) {
    const start = fromMinutes(cursor);
    const finish = fromMinutes(cursor + slot);
    const inBreak =
      breakStart !== null &&
      breakEnd !== null &&
      overlaps(start, finish, fromMinutes(breakStart), fromMinutes(breakEnd));
    const conflict = bookings.some((b) => overlaps(start, finish, b.startTime, b.endTime));
    const isPast =
      dateISO < new Date().toISOString().slice(0, 10) ||
      (dateISO === new Date().toISOString().slice(0, 10) &&
        cursor <= new Date().getHours() * 60 + new Date().getMinutes());
    if (!inBreak && !conflict && !isPast) slots.push(start);
    cursor += slot;
  }

  const dailyCount = bookings.length;
  if (dailyCount >= barber.maxDailyAppointments) return [];

  return slots;
}

export async function assertSlotFree(params: {
  barberId: string;
  dateISO: string;
  startTime: string;
  durationMin: number;
  excludeBookingId?: string;
}) {
  const endTime = addMinutes(params.startTime, params.durationMin);
  const slots = await getAvailableSlots(params.barberId, params.dateISO);
  if (!slots.includes(params.startTime)) {
    throw new AppError("This time slot is no longer available.", 409, "SLOT_TAKEN");
  }
  const conflict = await prisma.booking.findFirst({
    where: {
      barberId: params.barberId,
      bookingDate: params.dateISO,
      status: { in: BLOCKING },
      id: params.excludeBookingId ? { not: params.excludeBookingId } : undefined,
    },
  });
  if (conflict && overlaps(params.startTime, endTime, conflict.startTime, conflict.endTime)) {
    throw new AppError("This time slot is no longer available.", 409, "SLOT_TAKEN");
  }
  return endTime;
}
