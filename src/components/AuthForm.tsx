"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui";
import Link from "next/link";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const next = useSearchParams().get("next") || "";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<"CUSTOMER" | "BARBER">("CUSTOMER");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      if (mode === "login") {
        const data = await api<{ user: { role: string } }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        router.push(next || dest(data.user.role));
      } else {
        const data = await api<{ user: { role: string } }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            email: form.get("email"),
            phone: form.get("phone"),
            password: form.get("password"),
            confirmPassword: form.get("confirmPassword"),
            role,
            referralCode: form.get("referralCode") || undefined,
          }),
        });
        router.push(data.user.role === "BARBER" ? "/barber/onboarding" : "/app");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Logo />
      <h1 className="mt-8 font-display text-3xl">
        {mode === "login" ? "Welcome back" : "Join CallNBarb"}
      </h1>
      <p className="mt-2 text-sm text-ink-200">
        {mode === "login" ? "Sign in to book or take jobs." : "Call a Barber. Get Fresh."}
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        {mode === "register" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {(["CUSTOMER", "BARBER"] as const).map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRole(r)}
                  className={`rounded-xl border px-3 py-2 text-sm ${role === r ? "border-gold-500 bg-gold-500/10" : "border-white/10"}`}
                >
                  {r === "CUSTOMER" ? "Customer" : "Barber"}
                </button>
              ))}
            </div>
            <input name="name" className="input" placeholder="Full name" required />
            <input name="phone" className="input" placeholder="Phone number" required />
          </>
        )}
        <input name="email" type="email" className="input" placeholder="Email" required />
        <input name="password" type="password" className="input" placeholder="Password" required minLength={8} />
        {mode === "register" && (
          <>
            <input name="confirmPassword" type="password" className="input" placeholder="Confirm password" required />
            <input name="referralCode" className="input" placeholder="Referral code (optional)" />
          </>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-200">
        {mode === "login" ? (
          <>
            New here? <Link className="text-gold-400" href="/register">Create an account</Link>
            <br />
            <Link className="text-gold-400" href="/forgot-password">Forgot password?</Link>
          </>
        ) : (
          <>
            Already registered? <Link className="text-gold-400" href="/login">Log in</Link>
          </>
        )}
      </p>
    </div>
  );
}

function dest(role: string) {
  if (role === "ADMIN") return "/admin";
  if (role === "BARBER") return "/barber";
  return "/app";
}
