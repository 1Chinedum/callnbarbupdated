import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/http";
import { formatMoney } from "@/lib/money";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const service = sp.get("service");
    const city = sp.get("city");
    const verified = sp.get("verified") === "true";
    const home = sp.get("home") === "true";
    const minRating = Number(sp.get("minRating") ?? 0);
    const maxPrice = sp.get("maxPrice") ? Number(sp.get("maxPrice")) : null;
    const sort = sp.get("sort") ?? "recommended";

    const barbers = await prisma.barberProfile.findMany({
      where: {
        verificationStatus: verified ? "VERIFIED" : { in: ["VERIFIED"] },
        homeService: home ? true : undefined,
        ratingAvg: minRating ? { gte: minRating } : undefined,
        city: city ? { contains: city } : undefined,
        user: { status: "ACTIVE", name: q ? { contains: q } : undefined },
        services: service
          ? { some: { active: true, OR: [{ name: { contains: service } }, { category: { slug: service } }] } }
          : { some: { active: true } },
      },
      include: {
        user: true,
        services: { where: { active: true }, include: { category: true } },
      },
    });

    let items = barbers.map((b) => {
      const prices = b.services.map((s) => s.priceKobo);
      const starting = prices.length ? Math.min(...prices) : 0;
      return {
        id: b.id,
        name: b.user.name,
        photo: b.user.profileImage,
        verified: b.verificationStatus === "VERIFIED",
        rating: b.ratingAvg,
        reviews: b.totalReviews,
        startingPriceKobo: starting,
        startingPrice: formatMoney(starting),
        city: b.city,
        serviceArea: b.serviceArea,
        homeService: b.homeService,
        experienceYears: b.experienceYears,
        bio: b.bio,
        completedJobs: b.completedJobs,
        services: b.services.map((s) => ({
          id: s.id,
          name: s.name,
          priceKobo: s.priceKobo,
          price: formatMoney(s.priceKobo),
          durationMin: s.durationMin,
          category: s.category.slug,
        })),
      };
    });

    if (maxPrice) items = items.filter((i) => i.startingPriceKobo <= maxPrice * 100);

    items.sort((a, b) => {
      if (sort === "rating") return b.rating - a.rating;
      if (sort === "price_asc") return a.startingPriceKobo - b.startingPriceKobo;
      if (sort === "price_desc") return b.startingPriceKobo - a.startingPriceKobo;
      return b.rating * 10 + b.reviews - (a.rating * 10 + a.reviews);
    });

    return json({ barbers: items });
  } catch (e) {
    return errorResponse(e);
  }
}
