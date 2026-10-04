import { prisma } from "@/lib/prisma";
import { BarberCard } from "@/components/BarberCard";
import { Logo } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Find barbers" };

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; service?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const service = sp.service ?? "";
  const barbers = await prisma.barberProfile.findMany({
    where: {
      verificationStatus: "VERIFIED",
      user: { status: "ACTIVE", name: q ? { contains: q } : undefined },
      services: service
        ? { some: { OR: [{ category: { slug: service } }, { name: { contains: service } }], active: true } }
        : { some: { active: true } },
    },
    include: { user: true, services: { where: { active: true } } },
  });

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-4 py-4">
        <Logo />
        <Link href="/login" className="btn-ghost">
          Log in
        </Link>
      </header>
      <div className="mx-auto max-w-5xl px-4 pb-16">
        <h1 className="font-display text-4xl">Discover barbers</h1>
        <form className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input name="q" defaultValue={q} className="input" placeholder="Search name, service, city" />
          <button className="btn-primary">Search</button>
        </form>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {barbers.length === 0 && (
            <p className="col-span-full text-ink-200">No barbers match those filters yet.</p>
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
