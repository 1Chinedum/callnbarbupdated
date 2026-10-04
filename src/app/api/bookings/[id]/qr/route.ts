import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import QRCode from "qrcode";
import { issueQrPlainToken } from "@/lib/bookings";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("CUSTOMER", "ADMIN");
    const { id } = await ctx.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundError("Booking not found.");
    if (session.role !== "ADMIN" && booking.customerId !== session.id) {
      throw new ForbiddenError();
    }
    if (["PENDING_PAYMENT", "CANCELLED", "REFUNDED"].includes(booking.status)) {
      throw new ForbiddenError("QR is not available for this booking.");
    }
    const payload = await issueQrPlainToken(booking.id);
    const dataUrl = await QRCode.toDataURL(payload, {
      margin: 1,
      width: 320,
      color: { dark: "#16130f", light: "#f7f1e6" },
    });
    return json({ qr: dataUrl, publicRef: booking.publicRef, status: booking.status });
  } catch (e) {
    return errorResponse(e);
  }
}
