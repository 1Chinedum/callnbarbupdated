import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

export async function creditServiceEarning(
  tx: Prisma.TransactionClient,
  params: { barberId: string; bookingId: string; earningKobo: number; feeKobo: number },
) {
  const existing = await tx.walletTransaction.findFirst({
    where: { bookingId: params.bookingId, type: "SERVICE_EARNING" },
  });
  if (existing) return existing;

  const wallet =
    (await tx.wallet.findUnique({ where: { barberId: params.barberId } })) ??
    (await tx.wallet.create({
      data: { barberId: params.barberId },
    }));

  const before = wallet.availableKobo;
  const after = before + params.earningKobo;

  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      availableKobo: after,
      totalEarnedKobo: { increment: params.earningKobo },
    },
  });

  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      bookingId: params.bookingId,
      type: "PLATFORM_FEE",
      amountKobo: params.feeKobo,
      balanceBefore: before,
      balanceAfter: before,
      description: "Platform commission on completed service",
      status: "SUCCESSFUL",
    },
  });

  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      bookingId: params.bookingId,
      type: "SERVICE_EARNING",
      amountKobo: params.earningKobo,
      balanceBefore: before,
      balanceAfter: after,
      description: "Service earning credited",
      status: "SUCCESSFUL",
    },
  });
}

export async function debitWithdrawal(
  tx: Prisma.TransactionClient,
  params: { barberId: string; amountKobo: number; withdrawalId: string },
) {
  const wallet = await tx.wallet.findUnique({ where: { barberId: params.barberId } });
  if (!wallet) throw new AppError("Wallet not found.");
  if (wallet.availableKobo < params.amountKobo) {
    throw new AppError("Insufficient wallet balance.");
  }
  const before = wallet.availableKobo;
  const after = before - params.amountKobo;
  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      availableKobo: after,
      pendingKobo: { increment: params.amountKobo },
    },
  });
  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      withdrawalId: params.withdrawalId,
      type: "WITHDRAWAL",
      amountKobo: params.amountKobo,
      balanceBefore: before,
      balanceAfter: after,
      description: "Withdrawal requested",
      status: "PENDING",
    },
  });
}

export async function settleWithdrawal(
  tx: Prisma.TransactionClient,
  params: { barberId: string; amountKobo: number; withdrawalId: string; success: boolean },
) {
  const wallet = await tx.wallet.findUnique({ where: { barberId: params.barberId } });
  if (!wallet) throw new AppError("Wallet not found.");

  if (params.success) {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingKobo: { decrement: params.amountKobo },
        totalWithdrawnKobo: { increment: params.amountKobo },
      },
    });
    await tx.walletTransaction.updateMany({
      where: { withdrawalId: params.withdrawalId, type: "WITHDRAWAL" },
      data: { status: "SUCCESSFUL" },
    });
  } else {
    const before = wallet.availableKobo;
    const after = before + params.amountKobo;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableKobo: after,
        pendingKobo: { decrement: params.amountKobo },
      },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        withdrawalId: params.withdrawalId,
        type: "REVERSAL",
        amountKobo: params.amountKobo,
        balanceBefore: before,
        balanceAfter: after,
        description: "Withdrawal reversed to available balance",
        status: "SUCCESSFUL",
      },
    });
    await tx.walletTransaction.updateMany({
      where: { withdrawalId: params.withdrawalId, type: "WITHDRAWAL" },
      data: { status: "FAILED" },
    });
  }
}
