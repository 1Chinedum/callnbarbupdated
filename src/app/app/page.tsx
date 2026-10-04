import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BarberCard } from "@/components/BarberCard";
import Link from "next/link";

export default async function CustomerHome() {
  const session = await getSession();
  const categories = await prisma.serviceCategory.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  const barbers = await prisma.barberProfile.findMany({
    where: { verificationStatus: "VERIFIED", user: { status: "ACTIVE" } },
    include: { user: true, services: { where: { active: true } } },
    take: 8,
  });
  const upcoming = await prisma.booking.count({
    where: {
      customerId: session!.id,
      status: { in: ["BARBER_PENDING", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "VERIFIED", "IN_PROGRESS"] },
    },
  });

  return (
    <div className="px-4 pb-8">
      <section className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-ink-800 to-gold-700/40 p-6">
        <p className="text-xs uppercase tracking-widest text-gold-300">Call a Barber. Get Fresh.</p>
        <h1 className="mt-2 font-display text-3xl">Fresh cut. Right at your doorstep.</h1>
        <p className="mt-2 text-sm text-ink-100">Book a professional barber and get your haircut wherever you are.</p>
        <Link href="/app/explore" className="btn-primary mt-4 inline-flex">
          Find a Barber
        </Link>
        {upcoming > 0 && (
          <p className="mt-3 text-xs text-gold-200">{upcoming} active appointment{upcoming > 1 ? "s" : ""}</p>
        )}
      </section>

      <form action="/app/explore" className="mt-6">
        <input name="q" className="input" placeholder="Search barber, service, location" />
      </form>

      <h2 className="mt-8 font-display text-xl">Categories</h2>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/app/explore?service=${c.slug}`}
            className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-xs"
          >
            {c.name}
          </Link>
        ))}
      </div>

      <h2 className="mt-8 font-display text-xl">Nearby / recommended</h2>
      <div className="mt-4 grid gap-4">
        {barbers.map((b) => (
          <BarberCard
            key={b.id}
            id={b.id}
            name={b.user.name}
            verified
            rating={b.ratingAvg}
            reviews={b.totalReviews}
            startingPriceKobo={b.services[0]?.priceKobo ?? 0}
            city={b.city}
            services={b.services}
            href={`/barbers/${b.id}`}
          />
        ))}
      </div>
    </div>
  );
}
