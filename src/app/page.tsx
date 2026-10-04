import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { BarberCard } from "@/components/BarberCard";
import { Logo } from "@/components/ui";

export default async function HomePage() {
  const barbers = await prisma.barberProfile.findMany({
    where: { verificationStatus: "VERIFIED", user: { status: "ACTIVE" } },
    include: { user: true, services: { where: { active: true } } },
    take: 6,
  });
  const categories = await prisma.serviceCategory.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div>
      <header className="flex items-center justify-between px-6 py-4">
        <Logo />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/explore" className="hidden sm:inline text-ink-200 hover:text-cream">
            Find barbers
          </Link>
          <Link href="/login" className="text-ink-200 hover:text-cream">
            Log in
          </Link>
          <Link href="/register" className="btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <section className="relative overflow-hidden px-6 pb-16 pt-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(212,168,75,0.18),transparent_45%)]" />
        <div className="relative mx-auto max-w-5xl">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-400">Call a Barber. Get Fresh.</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-tight md:text-7xl">
            Fresh cut. Right at your doorstep.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-200">
            Book a professional barber and get your haircut wherever you are. Pay securely. Verify with QR.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/explore" className="btn-primary">
              Find a Barber
            </Link>
            <Link href="/register" className="btn-ghost">
              Become a barber
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-2xl">Popular services</h2>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/explore?service=${c.slug}`}
                className="whitespace-nowrap rounded-full border border-white/10 px-4 py-2 text-sm hover:border-gold-500"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-2xl">Recommended barbers</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {barbers.map((b) => (
              <BarberCard
                key={b.id}
                id={b.id}
                name={b.user.name}
                verified
                rating={b.ratingAvg}
                reviews={b.totalReviews}
                startingPriceKobo={Math.min(...b.services.map((s) => s.priceKobo), 0) || (b.services[0]?.priceKobo ?? 0)}
                city={b.city}
                services={b.services}
              />
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 text-sm text-ink-200">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4 justify-between">
          <p>CallNBarb — Your barber, wherever you are.</p>
          <div className="flex gap-4">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/cancellation">Cancellation</Link>
            <Link href="/about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
