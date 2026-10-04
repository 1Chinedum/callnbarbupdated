import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/ui";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/app");
  if (session.role === "BARBER") redirect("/barber");
  if (session.role === "ADMIN") redirect("/admin");
  return (
    <div className="nav-safe mx-auto min-h-screen max-w-lg">
      <AppHeader />
      {children}
      <BottomNav variant="customer" />
    </div>
  );
}
