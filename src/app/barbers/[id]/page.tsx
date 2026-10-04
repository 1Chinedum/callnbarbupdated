import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import Link from "next/link";
import { Logo } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.barberProfile.findUnique({
    where: { id },
    include: { user: true },
  });
  return { title: b ? b.user.name : "Barber" };
}

export default async function BarberPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.barberProfile.findUnique({
    where: { id },
    include: {
      user: true,
      services: { where: { active: true } },
      availability: true,
      reviews: { include: { customer: true }, take: 8, orderBy: { createdAt: "desc" } },
    },
  });
  if (!b) notFound();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Logo />
      <div className="mt-6 overflow-hidden rounded-3xl border border-white/10">
        <div className="h-44 bg-gradient-to-r from-ink-800 to-gold-700/50" />
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="font-display text-3xl">{b.user.name}</h1>
              <p className="text-sm text-ink-200">
                {b.ratingAvg.toFixed(1)} ★ · {b.totalReviews} reviews · {b.experienceYears} yrs · {b.completedJobs} cuts
              </p>
            </div>
            {b.verificationStatus === "VERIFIED" && (
              <span className="rounded-full bg-gold-500/20 px-3 py-1 text-xs text-gold-400">Verified</span>
            )}
          </div>
          <p className="mt-4 text-ink-200">{b.bio}</p>
          <p className="mt-2 text-sm">Service area: {b.serviceArea ?? b.city}</p>
          <div className="mt-6 flex gap-3">
            <Link href={`/app/book/${b.id}`} className="btn-primary">
              Book Now
            </Link>
            <Link href="/app/support" className="btn-ghost">
              Contact / Support
            </Link>
          </div>
        </div>
      </div>

      <h2 className="mt-8 font-display text-2xl">Services</h2>
      <ul className="mt-3 space-y-2">
        {b.services.map((s) => (
          <li key={s.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{s.name}</p>
              <p className="text-xs text-ink-200">{s.durationMin} min · {s.description}</p>
            </div>
            <p>{formatMoney(s.priceKobo)}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-display text-2xl">Hours</h2>
      <ul className="mt-3 space-y-1 text-sm text-ink-200">
        {b.availability
          .filter((a) => a.active)
          .map((a) => (
            <li key={a.id}>
              {days[a.dayOfWeek]} · {a.startTime} – {a.endTime}
            </li>
          ))}
      </ul>

      <h2 className="mt-8 font-display text-2xl">Reviews</h2>
      <div className="mt-3 space-y-3">
        {b.reviews.length === 0 && <p className="text-ink-200">No reviews yet.</p>}
        {b.reviews.map((r) => (
          <div key={r.id} className="card p-4">
            <p className="text-sm font-semibold">
              {r.customer.name.split(" ")[0]} · {"★".repeat(r.rating)}
            </p>
            <p className="text-sm text-ink-200">{r.comment}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
