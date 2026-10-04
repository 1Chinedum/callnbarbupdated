import Link from "next/link";
import { formatMoney } from "@/lib/money";

export function BarberCard(props: {
  id: string;
  name: string;
  photo?: string | null;
  verified: boolean;
  rating: number;
  reviews: number;
  startingPriceKobo: number;
  city?: string | null;
  services: { name: string }[];
  href?: string;
}) {
  return (
    <article className="card overflow-hidden">
      <div className="h-36 bg-gradient-to-br from-ink-800 to-gold-700/40" />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg">{props.name}</h3>
            <p className="text-xs text-ink-200">
              {props.city ?? "Service area"} · {props.rating.toFixed(1)} ★ ({props.reviews})
            </p>
          </div>
          {props.verified && (
            <span className="rounded-full bg-gold-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-400">
              Verified
            </span>
          )}
        </div>
        <p className="text-sm text-ink-200">
          From <span className="text-cream">{formatMoney(props.startingPriceKobo)}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {props.services.slice(0, 3).map((s) => (
            <span key={s.name} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px]">
              {s.name}
            </span>
          ))}
        </div>
        <Link href={props.href ?? `/barbers/${props.id}`} className="btn-primary w-full">
          Book Now
        </Link>
      </div>
    </article>
  );
}
