import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { requireBarberProfile } from "@/lib/qr";
import { formatMoney } from "@/lib/money";

export async function GET() {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const wallet = await prisma.wallet.findUnique({
      where: { barberId: profile.id },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    return json({
      wallet: wallet
        ? {
            available: formatMoney(wallet.availableKobo),
            pending: formatMoney(wallet.pendingKobo),
            totalEarned: formatMoney(wallet.totalEarnedKobo),
            totalWithdrawn: formatMoney(wallet.totalWithdrawnKobo),
            availableKobo: wallet.availableKobo,
            transactions: wallet.transactions.map((t) => ({
              id: t.id,
              type: t.type,
              amount: formatMoney(t.amountKobo),
              status: t.status,
              description: t.description,
              createdAt: t.createdAt,
            })),
          }
        : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
