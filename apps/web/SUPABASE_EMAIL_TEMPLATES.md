# Supabase Email Templates (Czech)

Paste these into the Supabase Dashboard under **Authentication → Email Templates**.

Both templates link to `{{ .SiteURL }}/auth/callback` with `token_hash` +
`type`, which the callback route verifies with `supabase.auth.verifyOtp()`.
This works even if the link is opened in a different browser or device than
the one that requested it (unlike the old PKCE `?code=` link, which requires
the same browser). Each template also includes the raw `{{ .Token }}` code so
the user can paste it into the app's "Kód z e-mailu" (OTP) fallback field on
the login page instead of clicking the link.

## Magic Link

**Subject:** Přihlašovací odkaz do aplikace

**Body (HTML):**

```html
<h2>Přihlášení</h2>

<p>Dobrý den,</p>

<p>klikněte na odkaz níže a přihlaste se do aplikace:</p>

<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Přihlásit se</a></p>

<p>Odkaz platí omezenou dobu. Otevřete jej v libovolném prohlížeči nebo zařízení.</p>

<p>Pokud odkaz nefunguje, zadejte v aplikaci na přihlašovací stránce tento kód:</p>

<p style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">{{ .Token }}</p>

<p>Pokud jste o přihlášení nežádali, tento e-mail ignorujte.</p>
```

## Confirm Signup

**Subject:** Potvrďte registraci

**Body (HTML):**

```html
<h2>Potvrzení registrace</h2>

<p>Dobrý den,</p>

<p>děkujeme za registraci. Potvrďte prosím svůj e-mail kliknutím na odkaz níže:</p>

<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup">Potvrdit registraci</a></p>

<p>Odkaz platí omezenou dobu. Otevřete jej v libovolném prohlížeči nebo zařízení.</p>

<p>Pokud odkaz nefunguje, zadejte v aplikaci na přihlašovací stránce tento kód:</p>

<p style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">{{ .Token }}</p>

<p>Pokud jste o registraci nežádali, tento e-mail ignorujte.</p>
```

## Notes

- `{{ .TokenHash }}` + `&type=email` / `&type=signup` lets
  `/auth/callback` call `supabase.auth.verifyOtp({ type, token_hash })`
  server-side — no PKCE `code_verifier` cookie required, so the link works
  cross-browser/cross-device (e.g. requested on desktop, opened from a phone's
  mail app).
- `{{ .Token }}` is the same one-time code Supabase would otherwise
  only expose via the raw OTP flow. The login page's "Kód z e-mailu" field
  calls `supabase.auth.verifyOtp({ email, token, type: 'email' })` with it.
- If you use other flows (invite, recovery, email change), use the matching
  `type` value in the link (`invite`, `recovery`, `email_change`) — the
  callback route already handles all `EmailOtpType` values.
