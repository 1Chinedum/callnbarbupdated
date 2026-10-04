"use client";

import { Logo } from "./ui";
import Link from "next/link";
import { Bell } from "lucide-react";

export function AppHeader({
  location = "Lagos",
  home = "/app",
}: {
  location?: string;
  home?: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/5 bg-ink-950/90 px-4 py-3 backdrop-blur">
      <Logo href={home} />
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden rounded-full border border-white/10 px-3 py-1 text-ink-200 sm:inline">
          {location}
        </span>
        <Link href="/app/support" className="rounded-full p-2 hover:bg-white/5" aria-label="Notifications">
          <Bell size={18} />
        </Link>
      </div>
    </header>
  );
}
