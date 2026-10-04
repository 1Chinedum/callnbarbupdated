import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { reviewSchema } from "@/lib/validators";
import { AppError, ForbiddenError } from "@/lib/errors";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("CUSTOMER");
    const { id } = await ctx.params;
    const body = reviewSchema.parse(await request.json());
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking || booking.customerId !== session.id) throw new ForbiddenError();
    if (booking.status !== "COMPLETED") {
      throw new AppError("You can only review completed appointments.");
    }
    const existing = await prisma.review.findUnique({ where: { bookingId: id } });
    if (existing) throw new AppError("This appointment already has a review.");

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          bookingId: id,
          customerId: session.id,
          barberId: booking.barberId,
          rating: body.rating,
          comment: body.comment,
        },
      });
      const agg = await tx.review.aggregate({
        where: { barberId: booking.barberId },
        _avg: { rating: true },
        _count: true,
      });
      await tx.barberProfile.update({
        where: { id: booking.barberId },
        data: {
          ratingAvg: agg._avg.rating ?? body.rating,
          totalReviews: agg._count,
        },
      });
      return created;
    });
    return json({ review }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
