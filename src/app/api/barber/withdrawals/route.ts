import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { requireBarberProfile } from "@/lib/qr";
import { withdrawalSchema } from "@/lib/validators";
import { getNumberSetting } from "@/lib/settings";
import { AppError } from "@/lib/errors";
import { debitWithdrawal } from "@/lib/wallet";
import { withdrawalReference } from "@/lib/crypto";
import { formatMoney } from "@/lib/money";
import { notify } from "@/lib/notify";
import { appConfig } from "@/lib/env";

export async function GET() {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const withdrawals = await prisma.withdrawal.findMany({
      where: { barberId: profile.id },
      orderBy: { createdAt: "desc" },
    });
    return json({
      withdrawals: withdrawals.map((w) => ({
        ...w,
        amount: formatMoney(w.amountKobo),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const body = withdrawalSchema.parse(await request.json());
    const min = await getNumberSetting("min_withdrawal_kobo");
    if (body.amountKobo < min) {
      throw new AppError(`Minimum withdrawal is ${formatMoney(min)}.`);
    }
    const withdrawal = await prisma.$transaction(async (tx) => {
      const created = await tx.withdrawal.create({
        data: {
          barberId: profile.id,
          amountKobo: body.amountKobo,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountName: body.accountName,
          status: "PENDING",
          reference: withdrawalReference(),
        },
      });
      await debitWithdrawal(tx, {
        barberId: profile.id,
        amountKobo: body.amountKobo,
        withdrawalId: created.id,
      });
      return created;
    });
    await notify({
      userId: session.id,
      title: "Withdrawal requested",
      message: `Your withdrawal of ${formatMoney(body.amountKobo)} is pending review.`,
      type: "withdrawal_requested",
    });
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    for (const admin of admins) {
      await notify({
        userId: admin.id,
        title: "Withdrawal pending",
        message: `${session.name} requested ${formatMoney(body.amountKobo)}.`,
        type: "admin_withdrawal",
      });
    }
    void appConfig;
    return json({ withdrawal }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
