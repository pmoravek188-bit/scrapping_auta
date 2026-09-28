"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Car, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  otp_failed:
    "Odkaz pro přihlášení je neplatný nebo vypršel. Požádejte o nový a otevřete ho ve stejném prohlížeči.",
  code_exchange_failed:
    "Odkaz pro přihlášení je neplatný nebo vypršel. Požádejte o nový a otevřete ho ve stejném prohlížeči.",
  missing_params: "Odkaz pro přihlášení je neplatný. Požádejte o nový.",
  not_configured: "Aplikace není nakonfigurovaná.",
};

/** Map a Supabase auth error to a Czech message, falling back to the raw message. */
function mapAuthError(message: string): string {
  if (message.includes("429") || /rate limit/i.test(message)) {
    return "Příliš mnoho pokusů, zkuste to za pár minut.";
  }
  return message;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-gray-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-bold text-gray-900">
          <Car className="h-7 w-7 text-brand-600" aria-hidden />
          Scrapping auta
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(
    callbackError ? (CALLBACK_ERROR_MESSAGES[callbackError] ?? CALLBACK_ERROR_MESSAGES.otp_failed) : null
  );

  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [otpError, setOtpError] = useState<string | null>(null);

  if (!isSupabaseConfigured()) {
    return (
      <LoginShell>
        <div className="card">
          <h1 className="mb-2 text-lg font-semibold">Aplikace není nakonfigurovaná</h1>
          <p className="text-sm text-gray-600">
            Chybí proměnné prostředí NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </p>
        </div>
      </LoginShell>
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
      setError(mapAuthError(error.message));
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    setOtpStatus("verifying");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    if (error) {
      setOtpError(mapAuthError(error.message));
      setOtpStatus("error");
    } else {
      window.location.href = "/";
    }
  }

  return (
    <LoginShell>
      <div className="card">
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Přihlášení</h1>
        <p className="mb-4 text-sm text-gray-600">
          Zadejte e-mail a pošleme vám přihlašovací odkaz (magic link).
        </p>
        {status === "sent" ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
              <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              Odkaz byl odeslán na <strong>{email}</strong>. Zkontrolujte si e-mail.
            </p>
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <div>
                <label className="label" htmlFor="otp">
                  Kód z e-mailu
                </label>
                <p className="mb-1 text-xs text-gray-500">
                  Pokud jste odkaz otevřeli v jiném prohlížeči nebo zařízení, zadejte
                  místo toho kód z e-mailu.
                </p>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  maxLength={10}
                  required
                  className="input"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                />
              </div>
              {otpError && <p className="text-sm text-red-600">{otpError}</p>}
              <button type="submit" className="btn w-full" disabled={otpStatus === "verifying"}>
                {otpStatus === "verifying" ? "Ověřuji…" : "Potvrdit kód"}
              </button>
            </form>
          </div>
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
    </LoginShell>
  );
}
