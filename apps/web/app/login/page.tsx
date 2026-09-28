"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto mt-16 max-w-md card">
        <h1 className="mb-2 text-lg font-semibold">Aplikace není nakonfigurovaná</h1>
        <p className="text-sm text-gray-600">
          Chybí proměnné prostředí NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card">
        <h1 className="mb-1 text-lg font-semibold">Přihlášení</h1>
        <p className="mb-4 text-sm text-gray-600">
          Zadejte e-mail a pošleme vám přihlašovací odkaz (magic link).
        </p>
        {status === "sent" ? (
          <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
            Odkaz byl odeslán na <strong>{email}</strong>. Zkontrolujte si e-mail.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vas@email.cz"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn w-full" disabled={status === "sending"}>
              {status === "sending" ? "Odesílám…" : "Poslat přihlašovací odkaz"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
