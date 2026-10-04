import { prisma } from "@/lib/prisma";
import { BarberCard } from "@/components/BarberCard";

export default async function AppExplore({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; service?: string }>;
}) {
  const sp = await searchParams;
  const barbers = await prisma.barberProfile.findMany({
    where: {
      verificationStatus: "VERIFIED",
      user: {
        status: "ACTIVE",
        name: sp.q ? { contains: sp.q } : undefined,
      },
      services: sp.service
        ? { some: { category: { slug: sp.service }, active: true } }
        : { some: { active: true } },
    },
    include: { user: true, services: { where: { active: true } } },
  });
  return (
    <div className="px-4 py-4">
      <h1 className="font-display text-3xl">Explore</h1>
      <form className="mt-4">
        <input name="q" defaultValue={sp.q} className="input" placeholder="Search" />
      </form>
      <div className="mt-6 grid gap-4">
        {barbers.length === 0 && (
          <div className="card p-8 text-center">
            <p>No barbers found.</p>
            <a href="/app" className="btn-primary mt-4 inline-flex">
              Find a Barber
            </a>
          </div>
        )}
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
