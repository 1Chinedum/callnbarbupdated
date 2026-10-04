"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Search,
  CalendarDays,
  LifeBuoy,
  User,
  LayoutDashboard,
  QrCode,
  Wallet,
} from "lucide-react";

const customer = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/explore", label: "Explore", icon: Search },
  { href: "/app/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/app/support", label: "Support", icon: LifeBuoy },
  { href: "/app/profile", label: "Profile", icon: User },
];

const barber = [
  { href: "/barber", label: "Home", icon: LayoutDashboard },
  { href: "/barber/bookings", label: "Jobs", icon: CalendarDays },
  { href: "/barber/scan", label: "Scan", icon: QrCode },
  { href: "/barber/wallet", label: "Wallet", icon: Wallet },
  { href: "/barber/profile", label: "Profile", icon: User },
];

export function BottomNav({ variant }: { variant: "customer" | "barber" }) {
  const path = usePathname();
  const items = variant === "customer" ? customer : barber;
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-ink-950/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-5 px-2 py-2">
        {items.map((item) => {
          const active = path === item.href || (item.href !== "/app" && item.href !== "/barber" && path.startsWith(item.href));
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-1 py-1 text-[11px] ${active ? "text-gold-400" : "text-ink-200"}`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-500 font-display text-lg text-ink-950">
        C
      </span>
      <span className="font-display text-xl tracking-tight">
        Call<span className="text-gold-400">N</span>Barb
      </span>
    </Link>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color: Record<string, string> = {
    PENDING_PAYMENT: "bg-amber-500/20 text-amber-200",
    BARBER_PENDING: "bg-sky-500/20 text-sky-200",
    ACCEPTED: "bg-emerald-500/20 text-emerald-200",
    ON_THE_WAY: "bg-indigo-500/20 text-indigo-200",
    ARRIVED: "bg-violet-500/20 text-violet-200",
    VERIFIED: "bg-gold-500/20 text-gold-300",
    IN_PROGRESS: "bg-gold-500/30 text-gold-200",
    COMPLETED: "bg-emerald-600/30 text-emerald-100",
    CANCELLED: "bg-red-500/20 text-red-200",
    DISPUTED: "bg-orange-500/20 text-orange-200",
    REFUNDED: "bg-white/10 text-ink-200",
    CONFIRMED: "bg-emerald-500/20 text-emerald-200",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${color[status] ?? "bg-white/10"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function useToast() {
  const router = useRouter();
  return {
    refresh: () => router.refresh(),
    say: (msg: string) => {
      if (typeof window !== "undefined") window.alert(msg);
    },
  };
}
