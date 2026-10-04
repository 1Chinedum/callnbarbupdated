"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/ui";
import { useRouter } from "next/navigation";

export default function ResetPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: form.get("token"), password: form.get("password") }),
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Logo />
      <h1 className="mt-8 font-display text-3xl">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input name="token" className="input" placeholder="Reset token" required />
        <input name="password" type="password" className="input" placeholder="New password" required minLength={8} />
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button className="btn-primary w-full">Update password</button>
      </form>
    </div>
  );
}
