import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { requireBarberProfile } from "@/lib/qr";
import { formatMoney } from "@/lib/money";
import { todayISO } from "@/lib/time";

export async function GET() {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const today = todayISO();
    const [todayBookings, pending, wallet, rating] = await Promise.all([
      prisma.booking.findMany({
        where: { barberId: profile.id, bookingDate: today, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] } },
        include: { customer: true, service: true, address: true },
      }),
      prisma.booking.findMany({
        where: { barberId: profile.id, status: "BARBER_PENDING" },
        include: { customer: true, service: true, address: true },
      }),
      prisma.wallet.findUnique({ where: { barberId: profile.id } }),
      prisma.barberProfile.findUnique({ where: { id: profile.id } }),
    ]);
    const todayEarnings = todayBookings
      .filter((b) => b.status === "COMPLETED")
      .reduce((s, b) => s + b.barberEarningKobo, 0);
    return json({
      todayAppointments: todayBookings.length,
      pendingRequests: pending.length,
      todayEarnings: formatMoney(todayEarnings),
      totalEarnings: formatMoney(wallet?.totalEarnedKobo ?? 0),
      walletBalance: formatMoney(wallet?.availableKobo ?? 0),
      completedJobs: rating?.completedJobs ?? 0,
      rating: rating?.ratingAvg ?? 0,
      pending,
      today: todayBookings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
