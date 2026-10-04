import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { formatMoney } from "@/lib/money";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { settleWithdrawal } from "@/lib/wallet";
import { getAllSettings, setSetting } from "@/lib/settings";
import { AppError } from "@/lib/errors";
import { refundPayment } from "@/lib/paystack";

export async function GET(request: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const path = request.nextUrl.searchParams.get("view") ?? "dashboard";
    const range = request.nextUrl.searchParams.get("range") ?? "30";

    if (path === "dashboard") {
      const [
        customers,
        barbers,
        verified,
        pending,
        bookings,
        completed,
        cancelled,
        payments,
        withdrawals,
        disputes,
      ] = await Promise.all([
        prisma.user.count({ where: { role: "CUSTOMER" } }),
        prisma.user.count({ where: { role: "BARBER" } }),
        prisma.barberProfile.count({ where: { verificationStatus: "VERIFIED" } }),
        prisma.barberProfile.count({ where: { verificationStatus: "PENDING" } }),
        prisma.booking.count(),
        prisma.booking.count({ where: { status: "COMPLETED" } }),
        prisma.booking.count({ where: { status: "CANCELLED" } }),
        prisma.payment.findMany({ where: { status: "SUCCESSFUL" } }),
        prisma.withdrawal.count({ where: { status: "PENDING" } }),
        prisma.dispute.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
      ]);
      const revenue = payments.reduce((s, p) => s + p.amountKobo, 0);
      const commission = (
        await prisma.booking.findMany({ where: { status: "COMPLETED" } })
      ).reduce((s, b) => s + b.platformFeeKobo, 0);
      const earnings = (
        await prisma.booking.findMany({ where: { status: "COMPLETED" } })
      ).reduce((s, b) => s + b.barberEarningKobo, 0);

      const days = Number(range) || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const recent = await prisma.booking.findMany({
        where: { createdAt: { gte: since }, status: { not: "PENDING_PAYMENT" } },
      });
      const byDay: Record<string, { bookings: number; revenue: number }> = {};
      for (const b of recent) {
        const d = b.createdAt.toISOString().slice(0, 10);
        byDay[d] ??= { bookings: 0, revenue: 0 };
        byDay[d].bookings += 1;
        byDay[d].revenue += b.amountKobo;
      }

      return json({
        stats: {
          customers,
          barbers,
          verified,
          pending,
          bookings,
          completed,
          cancelled,
          revenue: formatMoney(revenue),
          commission: formatMoney(commission),
          earnings: formatMoney(earnings),
          pendingWithdrawals: withdrawals,
          openDisputes: disputes,
        },
        series: Object.entries(byDay).map(([date, v]) => ({
          date,
          bookings: v.bookings,
          revenue: v.revenue / 100,
        })),
      });
    }

    if (path === "customers") {
      const users = await prisma.user.findMany({
        where: { role: "CUSTOMER" },
        orderBy: { createdAt: "desc" },
      });
      return json({ users });
    }
    if (path === "barbers") {
      const barbers = await prisma.barberProfile.findMany({
        include: { user: true, wallet: true },
        orderBy: { createdAt: "desc" },
      });
      return json({ barbers });
    }
    if (path === "bookings") {
      const bookings = await prisma.booking.findMany({
        include: { customer: true, barber: { include: { user: true } }, service: true, payments: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return json({ bookings });
    }
    if (path === "payments") {
      const payments = await prisma.payment.findMany({
        include: { customer: true, booking: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return json({ payments });
    }
    if (path === "withdrawals") {
      const withdrawals = await prisma.withdrawal.findMany({
        include: { barber: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
      });
      return json({ withdrawals });
    }
    if (path === "disputes") {
      const disputes = await prisma.dispute.findMany({
        include: { booking: true, openedBy: true },
        orderBy: { createdAt: "desc" },
      });
      return json({ disputes });
    }
    if (path === "support") {
      const tickets = await prisma.supportTicket.findMany({
        include: { user: true, messages: true },
        orderBy: { createdAt: "desc" },
      });
      return json({ tickets });
    }
    if (path === "reviews") {
      const reviews = await prisma.review.findMany({
        include: { customer: true, barber: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
      });
      return json({ reviews });
    }
    if (path === "audit") {
      const logs = await prisma.auditLog.findMany({
        include: { admin: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return json({ logs });
    }
    if (path === "settings") {
      return json({ settings: await getAllSettings() });
    }
    if (path === "services") {
      const services = await prisma.serviceCategory.findMany({ orderBy: { sortOrder: "asc" } });
      return json({ services });
    }
    void session;
    throw new AppError("Unknown admin view.");
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await request.json();
    const action = body.action as string;

    if (action === "verify_barber") {
      await prisma.barberProfile.update({
        where: { id: body.barberId },
        data: {
          verificationStatus: body.decision === "approve" ? "VERIFIED" : "REJECTED",
          verificationNote: body.reason,
        },
      });
      const barber = await prisma.barberProfile.findUniqueOrThrow({
        where: { id: body.barberId },
      });
      await notify({
        userId: barber.userId,
        title: body.decision === "approve" ? "Verification approved" : "Verification rejected",
        message:
          body.decision === "approve"
            ? "You can now receive bookings on CallNBarb."
            : body.reason ?? "Your verification was not approved.",
        type: "verification",
      });
      await audit({
        adminId: session.id,
        action: body.decision === "approve" ? "barber.approve" : "barber.reject",
        entityType: "barber",
        entityId: body.barberId,
        metadata: { reason: body.reason },
      });
      return json({ ok: true });
    }

    if (action === "user_status") {
      await prisma.user.update({
        where: { id: body.userId },
        data: { status: body.status },
      });
      await audit({
        adminId: session.id,
        action: "user.status",
        entityType: "user",
        entityId: body.userId,
        metadata: { status: body.status },
      });
      return json({ ok: true });
    }

    if (action === "withdrawal") {
      const w = await prisma.withdrawal.findUniqueOrThrow({ where: { id: body.withdrawalId } });
      if (body.decision === "approve") {
        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { status: "PROCESSING" },
        });
      } else if (body.decision === "reject") {
        await prisma.$transaction(async (tx) => {
          await tx.withdrawal.update({
            where: { id: w.id },
            data: { status: "REJECTED", rejectReason: body.reason },
          });
          await settleWithdrawal(tx, {
            barberId: w.barberId,
            amountKobo: w.amountKobo,
            withdrawalId: w.id,
            success: false,
          });
        });
      } else if (body.decision === "process") {
        await prisma.$transaction(async (tx) => {
          await tx.withdrawal.update({
            where: { id: w.id },
            data: { status: "SUCCESSFUL", processedAt: new Date() },
          });
          await settleWithdrawal(tx, {
            barberId: w.barberId,
            amountKobo: w.amountKobo,
            withdrawalId: w.id,
            success: true,
          });
        });
        const barber = await prisma.barberProfile.findUniqueOrThrow({ where: { id: w.barberId } });
        await notify({
          userId: barber.userId,
          title: "Withdrawal completed",
          message: "Your withdrawal has been processed.",
          type: "withdrawal_completed",
        });
      }
      await audit({
        adminId: session.id,
        action: `withdrawal.${body.decision}`,
        entityType: "withdrawal",
        entityId: w.id,
      });
      return json({ ok: true });
    }

    if (action === "settings") {
      for (const [key, value] of Object.entries(body.values ?? {})) {
        await setSetting(key, String(value));
      }
      await audit({
        adminId: session.id,
        action: "settings.update",
        entityType: "settings",
        entityId: "platform",
        metadata: body.values,
      });
      return json({ ok: true });
    }

    if (action === "dispute") {
      await prisma.dispute.update({
        where: { id: body.disputeId },
        data: {
          status: body.status,
          adminNotes: body.adminNotes,
          resolution: body.resolution,
        },
      });
      await audit({
        adminId: session.id,
        action: "dispute.update",
        entityType: "dispute",
        entityId: body.disputeId,
      });
      return json({ ok: true });
    }

    if (action === "ticket") {
      await prisma.supportTicket.update({
        where: { id: body.ticketId },
        data: { status: body.status },
      });
      if (body.message) {
        await prisma.ticketMessage.create({
          data: { ticketId: body.ticketId, authorId: session.id, body: body.message },
        });
      }
      return json({ ok: true });
    }

    if (action === "refund") {
      await refundPayment({
        paymentId: body.paymentId,
        amountKobo: body.amountKobo,
        reason: body.reason ?? "Admin refund",
        adminId: session.id,
      });
      await audit({
        adminId: session.id,
        action: "payment.refund",
        entityType: "payment",
        entityId: body.paymentId,
      });
      return json({ ok: true });
    }

    if (action === "service_category") {
      if (body.id) {
        await prisma.serviceCategory.update({
          where: { id: body.id },
          data: { name: body.name, active: body.active, description: body.description },
        });
      } else {
        await prisma.serviceCategory.create({
          data: {
            name: body.name,
            slug: String(body.name).toLowerCase().replace(/\s+/g, "-"),
            description: body.description,
          },
        });
      }
      return json({ ok: true });
    }

    throw new AppError("Unknown admin action.");
  } catch (e) {
    return errorResponse(e);
  }
}
