"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/ui";

export default function ForgotPage() {
  const [msg, setMsg] = useState("");
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = await api<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email") }),
    });
    setMsg(data.message);
  }
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Logo />
      <h1 className="mt-8 font-display text-3xl">Reset password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input name="email" type="email" className="input" placeholder="Email" required />
        <button className="btn-primary w-full">Send reset</button>
      </form>
      {msg && <p className="mt-4 text-sm text-ink-200">{msg}</p>}
    </div>
  );
}
