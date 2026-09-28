# Scrapping auta – návrh aplikace

> Stav: **NÁVRH v2 k odsouhlasení** (Supabase + Vercel, rozšířené zdroje).
> Implementaci provede další agent (Sonnet) podle tohoto dokumentu.

## 1. Cíl

Aplikace pravidelně prohledává co nejvíce autobazarů a prodejců ojetin podle
hledání, která si zadám (značka, model, rok, cena, nájezd, palivo, převodovka…).
Výsledky sjednotí do jednoho seznamu, odstraní duplicity, hlídá změny ceny
a pošle upozornění na nové / zlevněné inzeráty.

## 2. Zdroje

Každý zdroj = samostatný **adaptér** (jeden soubor). Před implementací adaptéru
se u webu ověří, jestli frontend nevolá JSON API (skoro vždy rychlejší a
stabilnější než parsovat HTML).

### Inzertní portály
| Prio | Zdroj | Pozn. |
|---|---|---|
| 1 | **Sauto.cz** | Největší v ČR, interní JSON API |
| 1 | **Bazoš.cz** (auto.bazos.cz) | HTML, hodně soukromníků |
| 1 | **TipCars.com** | HTML, hodně dealerů |
| 2 | **AutoScout24** (.cz/.de) | `__NEXT_DATA__` JSON |
| 3 | **Mobile.de** | silná ochrana, Playwright, volitelně |
| 3 | **Autobazar.eu** (SK) | HTML |

### Velcí prodejci ojetin
| Prio | Zdroj | Pozn. |
|---|---|---|
| 1 | **Carvago** (carvago.com/cz) | velký EU sklad, JSON API |
| 1 | **Das WeltAuto** (dasweltauto.cz) | certifikované vozy koncernu VW |
| 1 | **AAA Auto** (aaaauto.cz) | největší síť autobazarů v ČR |
| 2 | **Havex** (havex.cz) | |
| 2 | **Auto ESA** (autoesa.cz) | |
| 2 | **Škoda Plus** (skodaplus.cz) | certifikované ojeté Škody |
| 3 | **Autorro**, **Spoticar**, BMW Premium Selection, Mercedes, Toyota Used… | značkové programy – přidávat postupně |

Seznam je otevřený – nový zdroj = nový adaptér + záznam v tabulce `sources`.

**Slušný scraping:** max. ~1 požadavek za 2–5 s na doménu, respektovat
`robots.txt`, žádné obcházení captchy/přihlášení, jen osobní použití.

## 3. Technologie

| Vrstva | Volba |
|---|---|
| Databáze, auth, úložiště | **Supabase** (Postgres + Auth + Row Level Security) |
| Web (UI + API) | **Next.js 15 (App Router, TypeScript)** na **Vercelu** |
| UI komponenty | Tailwind CSS + shadcn/ui |
| Scrapery | **TypeScript (Node 22)**: `undici`/`fetch` + `cheerio`, **Playwright** jen kde je nutný |
| Spouštění scraperů | **GitHub Actions cron** (každých 30 min) |
| Notifikace | **Telegram bot** + e-mail (Resend), volá se po každém běhu |
| Validace / typy | `zod`, typy generované ze Supabase (`supabase gen types`) |
| Testy | `vitest` + uložené HTML/JSON fixtury (bez sítě) |
| Monorepo | `pnpm` workspaces |

### Proč scrapery neběží na Vercelu
- Vercel funkce mají časový limit a Playwright se do nich špatně vejde.
- Vercel Cron je na Hobby plánu omezený (1× denně).
- GitHub Actions: zdarma, běh až 6 h, Playwright funguje, cron co 30 min,
  a běží s IP, která se mění (menší šance na blokaci).

Vercel tedy hostí jen web; scrapery zapisují přímo do Supabase přes
`service_role` klíč uložený v GitHub Secrets.

*(Alternativa: Supabase Edge Functions + `pg_cron` – jen pro jednoduché JSON zdroje
bez Playwrightu. Může se přidat později.)*

## 4. Architektura

```
  ┌──────────────── Vercel ────────────────┐
  │ Next.js: přihlášení, správa hledání,   │
  │ výsledky, detail + graf ceny, oblíbené │
  └───────────────┬────────────────────────┘
                  │ supabase-js (anon key + RLS)
          ┌───────▼──────────────── Supabase ─┐
          │ Postgres: searches, listings,      │
          │ price_history, matches, sources,   │
          │ scrape_runs   ·  Auth              │
          └───────▲────────────────────────────┘
                  │ service_role key
  ┌───────────────┴─── GitHub Actions (cron 30 min) ───┐
  │ runner: načte aktivní hledání → pro každý zdroj    │
  │   adaptér.search() → normalizace → upsert          │
  │   → dedup → price_history → nové shody → notifikace│
  └────────────────────────────────────────────────────┘
```

Zdroje se v Actions spouštějí paralelně (matrix podle zdroje), aby pád
jednoho bazaru nezastavil ostatní.

### Rozhraní adaptéru

```ts
export interface SourceAdapter {
  id: string;                                   // "sauto", "carvago", ...
  needsBrowser?: boolean;                       // Playwright
  search(q: SearchQuery, ctx: Ctx): AsyncIterable<RawListing>;
  normalize(raw: RawListing): Listing;          // sjednocení do společného tvaru
}
```

## 5. Datový model (Supabase / Postgres)

- **searches** – `id, user_id, name, enabled, make, model, year_from, year_to,
  price_from, price_to, mileage_max, fuel[], transmission, body[], power_min_kw,
  keywords[], exclude_keywords[], sources[], notify, created_at`
- **listings** – `id, source, source_id (unique se source), url, title, make, model,
  variant, year, mileage_km, price_czk, price_orig, currency_orig, fuel,
  transmission, power_kw, body, color, location, country, seller_type
  (private/dealer), vin, image_urls[], first_seen, last_seen, is_active,
  fingerprint, group_id`
- **price_history** – `listing_id, price_czk, seen_at`
- **matches** – `search_id, listing_id, matched_at, notified_at, status
  (new/favorite/hidden)`
- **sources** – `id, name, enabled, last_run_at, last_ok_at, last_count`
- **scrape_runs** – `id, source, started_at, finished_at, found, new, errors`
- **exchange_rates** – denní kurz ČNB (EUR→CZK)

**Deduplikace:** stejný VIN → stejné auto; jinak `fingerprint`
(značka+model+rok+nájezd zaokrouhlený na 1000 km+výkon) → společné `group_id`,
v UI se zobrazí jako jedno auto s více nabídkami (a nejnižší cenou).

**RLS:** uživatel vidí a upravuje jen svá `searches`/`matches`; `listings` jsou
jen pro čtení; zápis dělá pouze runner (service_role).

## 6. Funkce

**MVP**
1. Přihlášení (Supabase Auth – magic link e-mailem)
2. Správa hledání ve webu (formulář s filtry, zapnout/vypnout)
3. Scraping: Sauto, Bazoš, TipCars, Carvago, Das WeltAuto, AAA Auto
4. Přehled výsledků: tabulka/karty, filtry, řazení (cena, rok, nájezd, nové)
5. Telegram / e-mail upozornění na nové shody
6. Stránka „Stav zdrojů“ – kdy který bazar naposledy fungoval

**Další fáze**
7. Další zdroje (Havex, Auto ESA, Škoda Plus, AutoScout24, Mobile.de, …)
8. Upozornění na zlevnění a na zmizelé (prodané) inzeráty
9. Graf historie ceny, „férová cena“ (medián podobných aut), štítek „pod cenou“
10. Oblíbené, skryté, poznámky k autu, porovnání vybraných aut

## 7. Struktura projektu

```
scrapping_auta/
├── DESIGN.md
├── README.md
├── package.json / pnpm-workspace.yaml
├── supabase/
│   ├── migrations/            # SQL schéma + RLS
│   └── seed.sql
├── apps/web/                  # Next.js → Vercel
│   ├── app/ (login, searches, results, listing/[id], sources)
│   └── lib/supabase/
├── packages/
│   ├── core/                  # typy, zod schémata, normalizace, dedup, matching
│   └── scrapers/
│       ├── src/http.ts        # rate-limit, retry, user-agent
│       ├── src/runner.ts
│       ├── src/notify/ (telegram.ts, email.ts)
│       ├── src/sources/ (sauto.ts, bazos.ts, tipcars.ts, carvago.ts,
│       │                 dasweltauto.ts, aaaauto.ts, havex.ts, …)
│       └── test/fixtures/
└── .github/workflows/
    ├── scrape.yml             # cron */30, matrix podle zdroje
    └── ci.yml                 # lint, typecheck, testy
```

## 8. Konfigurace (secrets)

- Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- GitHub Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`

## 9. Plán implementace (pro Sonnet)

1. Monorepo kostra (pnpm, TS, eslint, vitest, CI workflow)
2. Supabase projekt + migrace (tabulky, indexy, RLS) + generované typy
3. `packages/core`: typy, normalizace (značky, paliva, měny), matching, dedup
4. `packages/scrapers`: http klient + runner + adaptéry **Sauto, Bazoš, TipCars** s testy
5. Adaptéry **Carvago, Das WeltAuto, AAA Auto** s testy
6. GitHub Actions `scrape.yml` + zápis `scrape_runs`
7. Next.js web: login, správa hledání, výsledky, detail, stav zdrojů → deploy na Vercel
8. Notifikace Telegram / e-mail
9. Další zdroje a funkce z fáze 2

Každý krok = samostatný commit; musí projít `pnpm lint && pnpm typecheck && pnpm test`.

## 10. Rizika

- **Změna webu bazaru** rozbije adaptér → testy na fixturách, `scrape_runs`
  a upozornění „zdroj X vrátil 0 výsledků 3× po sobě“.
- **Blokace (403/captcha)** → nízká frekvence, Playwright, nic neobcházet násilím.
- **Limity free plánů**: Supabase free (500 MB DB, pauza po týdnu nečinnosti –
  pravidelný cron ji drží aktivní), GitHub Actions free minuty (u privátního
  repa 2000 min/měsíc → při 30min intervalu hlídat délku běhu, případně 1× za hodinu).
- **Podmínky použití** webů → jen osobní, nekomerční použití.
