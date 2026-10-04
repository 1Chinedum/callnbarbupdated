import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/http";
import { formatMoney } from "@/lib/money";
import { NotFoundError } from "@/lib/errors";
import { getAvailableSlots } from "@/lib/slots";
import { todayISO } from "@/lib/time";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await prisma.barberProfile.findUnique({
      where: { id },
      include: {
        user: true,
        services: { where: { active: true }, include: { category: true } },
        availability: true,
        reviews: {
          include: { customer: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        portfolio: true,
      },
    });
    if (!b || b.user.status !== "ACTIVE") throw new NotFoundError("Barber not found.");

    const dates: { date: string; slots: string[] }[] = [];
    const start = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = todayISO(d);
      const slots = await getAvailableSlots(b.id, iso);
      dates.push({ date: iso, slots });
    }

    return json({
      barber: {
        id: b.id,
        name: b.user.name,
        photo: b.user.profileImage,
        verified: b.verificationStatus === "VERIFIED",
        verificationStatus: b.verificationStatus,
        rating: b.ratingAvg,
        reviews: b.totalReviews,
        experienceYears: b.experienceYears,
        bio: b.bio,
        city: b.city,
        state: b.state,
        serviceArea: b.serviceArea,
        completedJobs: b.completedJobs,
        homeService: b.homeService,
        services: b.services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          priceKobo: s.priceKobo,
          price: formatMoney(s.priceKobo),
          durationMin: s.durationMin,
        })),
        hours: b.availability
          .filter((a) => a.active)
          .map((a) => ({
            dayOfWeek: a.dayOfWeek,
            startTime: a.startTime,
            endTime: a.endTime,
          })),
        reviewList: b.reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          name: r.customer.name.split(" ")[0],
          createdAt: r.createdAt,
        })),
        portfolio: b.portfolio,
        dates,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
