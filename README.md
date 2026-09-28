# Scrapping auta

Aplikace, která pravidelně prohledává vybrané autobazary a prodejce ojetin,
sjednocuje nalezené inzeráty do jednoho přehledu, hlídá historii ceny,
odstraňuje duplicity napříč zdroji a posílá e-mailem upozornění na nové
nabídky, které odpovídají uloženým hledáním. Návrh je popsán v
[`DESIGN.md`](./DESIGN.md), tento README popisuje výslednou implementaci.

Celé řešení běží na **free tierech**: Supabase (Postgres + Auth), Vercel
Hobby (web) a GitHub Actions na veřejném repozitáři (scraper).

## Architektura

```
scrapping_auta/
├── apps/web/              Next.js 15 (App Router) → Vercel
│   ├── app/                přihlášení, hledání, výsledky, detail, stav zdrojů
│   ├── components/         sdílené UI komponenty
│   └── lib/supabase/       klienti pro Supabase (browser/server) + middleware
├── packages/core/          typy, zod schémata, normalizace, matcher, dedup
├── packages/scrapers/      HTTP klient, adaptéry zdrojů, runner, notifikace
├── supabase/migrations/    SQL schéma + RLS politiky + seed zdrojů
└── .github/workflows/      ci.yml (lint/typecheck/test/build), scrape.yml (cron)
```

- **Databáze/Auth**: Supabase Postgres s Row Level Security. Uživatel vidí a
  upravuje jen svá `searches`/`matches`; `listings`, `price_history`,
  `sources`, `scrape_runs`, `exchange_rates` jsou pro přihlášené uživatele
  jen ke čtení — zapisuje do nich pouze scraper přes `service_role` klíč
  (RLS pro service_role neplatí, takže žádné insert/update politiky pro tyto
  tabulky nejsou potřeba).
- **Web**: Next.js 15 App Router + Tailwind CSS, ručně psané komponenty
  (žádná těžká UI knihovna). Přihlášení přes Supabase Auth magic link
  (`@supabase/ssr`), middleware chrání všechny stránky kromě `/login` a
  `/auth/callback`.
- **Scraper**: TypeScript běžící v GitHub Actions (cron `*/30 * * * *` +
  ruční spuštění s volitelným `source` inputem). Jeden job spustí všechny
  zapnuté zdroje souběžně v procesu — pád jednoho zdroje nezastaví ostatní,
  chyby se zapisují do `scrape_runs`.
- **Notifikace**: pouze e-mail, přes Resend REST API (`fetch`, žádné SDK).
  Posílá se souhrnný digest (HTML + textová záloha) s kartičkami aut po
  jednotlivých hledáních, max. ~20 aut na hledání v jednom e-mailu. Bez
  `RESEND_API_KEY`/`NOTIFY_EMAIL_TO` se notifikace tiše přeskočí (jen se
  zaloguje).

## Lokální vývoj

Vyžaduje Node 22 a pnpm 10.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Web (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local
# doplňte NEXT_PUBLIC_SUPABASE_URL a NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm --filter @scrapping-auta/web dev
```

Bez nastavených proměnných prostředí web nadále projde `next build` (build je
staticky negenerovaný, stránky běží dynamicky) a zobrazí uživateli hlášku „Aplikace
není nakonfigurovaná“ místo pádu.

### Scraper (`packages/scrapers`)

```bash
cp .env.example .env
# doplňte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY (volitelně i Resend proměnné)
pnpm scrape                 # plný běh, zapisuje do Supabase
pnpm scrape -- --dry-run    # jen vypíše nalezené inzeráty, nic nezapisuje
pnpm scrape -- --source=sauto   # jen jeden zdroj
```

Bez `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` skript skončí s exit code 0 a
varováním (stejné chování jako v GitHub Actions, dokud nejsou nastavené
secrets).

## Nastavení Supabase

Projekt (`lhzfrzfutlzqysyuldtw`, region `eu-central-1`) už existuje. Migrace v
`supabase/migrations/` je potřeba aplikovat (Supabase CLI nebo Dashboard →
SQL editor, v pořadí podle názvu souboru):

1. `20260928120000_init.sql` — tabulky, indexy, RLS politiky
2. `20260928120100_seed_sources.sql` — počáteční seznam zdrojů

V Supabase Auth zapněte metodu **Email OTP / Magic Link** (výchozí nastavení)
a nastavte **Site URL** a **Redirect URLs** na adresu nasazeného webu
(`https://<vase-vercel-domena>/auth/callback`).

TypeScript typy pro databázi jsou ručně napsané v
`packages/core/src/database.types.ts` podle migrace výše. Po aplikaci migrace
je možné je nahradit vygenerovanými typy:

```bash
supabase gen types typescript --project-id lhzfrzfutlzqysyuldtw > packages/core/src/database.types.ts
```

## Nasazení na Vercel

1. Import repozitáře do Vercel, **Root Directory** = `apps/web`.
2. Framework preset Next.js se detekuje automaticky.
3. Nastavte proměnné prostředí projektu:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Vercel Hobby stačí — web je čistě čtecí/zápisové UI nad Supabase,
   žádné vlastní API routy kromě `/auth/callback`.

## Nastavení GitHub Secrets (scraper)

V **Settings → Secrets and variables → Actions** repozitáře nastavte:

| Secret | Povinný | Popis |
|---|---|---|
| `SUPABASE_URL` | ano | URL Supabase projektu |
| `SUPABASE_SERVICE_ROLE_KEY` | ano | service_role klíč (obchází RLS, nikdy nedávat do webu!) |
| `RESEND_API_KEY` | ne | API klíč z [resend.com](https://resend.com) — bez něj se e-maily neposílají |
| `NOTIFY_EMAIL_TO` | ne | e-mail, na který chodí souhrn nových nabídek |
| `NOTIFY_EMAIL_FROM` | ne | odchozí adresa, výchozí `Scrapping auta <onboarding@resend.dev>` |

**Poznámka k Resend free tieru**: bez ověřené vlastní domény umí Resend
posílat pouze z adresy `onboarding@resend.dev` a pouze **na e-mail majitele
Resend účtu**. Pro víc příjemců nebo vlastní odesílací adresu je potřeba
zdarma ověřit vlastní doménu v Resendu.

Workflow `scrape.yml` běží každých 30 minut (`workflow_dispatch` navíc
umožňuje ruční spuštění, volitelně jen pro jeden zdroj) a zároveň drží
Supabase free projekt aktivní (jinak po týdnu nečinnosti pauzuje).

## Ověřené vs. neověřené adaptéry zdrojů

Tento sandbox nemá přístup k internetu mimo npm registry, takže žádný z
adaptérů se nepodařilo ověřit proti živému webu. Všechny jsou napsané z
veřejně dostupných znalostí o daných webech, defenzivně (zod `safeParse` /
tolerantní CSS selektory, tiché přeskočení nevalidní položky, log počtu
nalezených inzerátů) a otestované proti ručně vytvořeným fixturám v
`packages/scrapers/test/fixtures/`. **Skutečné ověření proběhne až při prvním
běhu v GitHub Actions** — sledujte stránku „Stav zdrojů“ a `scrape_runs.errors`.

| Zdroj | Stav | Poznámka |
|---|---|---|
| `sauto` | zapnuto, neověřeno | JSON API `www.sauto.cz/api/v1/items/search`, parsování tolerantní k chybějícím polím |
| `bazos` | zapnuto, neověřeno | HTML parsování (`auto.bazos.cz`), žádné JSON API |
| `tipcars` | zapnuto, neověřeno | HTML parsování, obecné selektory karet inzerátů |
| `carvago` | zapnuto, neověřeno | Předpokládané JSON API (`POST /v2/vehicles/search`), tvar požadavku/odpovědi bude potřeba doladit |
| `dasweltauto` | zapnuto, neověřeno | HTML parsování |
| `aaaauto` | zapnuto, neověřeno | HTML parsování |
| `havex` | **vypnuto** v seedu | obecný HTML adaptér, není ověřený |
| `autoesa` | **vypnuto** v seedu | obecný HTML adaptér, není ověřený |
| `skodaplus` | **vypnuto** v seedu | obecný HTML adaptér, není ověřený |
| `autoscout24` | **vypnuto** v seedu | AutoScout24 pravděpodobně embeduje výsledky v `__NEXT_DATA__`; stub zatím používá obecný HTML parser jako placeholder |

Zdroje se zapínají/vypínají v tabulce `sources` (sloupec `enabled`).

## Jak přidat nový zdroj

1. Vytvořte `packages/scrapers/src/sources/<id>.ts` implementující rozhraní
   `SourceAdapter` z `packages/scrapers/src/adapter.ts` (metoda
   `search(query, ctx)` vracející `RawListing[]`). Pro jednoduché HTML
   zdroje lze použít `makeGenericHtmlAdapter` z `sources/generic-html.ts`.
2. Přidejte fixturu (uložená HTML/JSON stránka) do
   `packages/scrapers/test/fixtures/` a test parsování v
   `packages/scrapers/test/<id>.test.ts` (bez síťového přístupu).
3. Zaregistrujte adaptér v `packages/scrapers/src/registry.ts`.
4. Přidejte řádek do `supabase/migrations/` (nová migrace, ne úprava staré) s
   `insert into public.sources (id, name, enabled) values (...)`.
5. `pnpm lint && pnpm typecheck && pnpm test` musí projít.

## Jádrová logika (`packages/core`)

- **Normalizace**: značky/modely (`make-model.ts`, alias tabulka
  `"škoda"→"skoda"`, `"vw"→"volkswagen"`, …), palivo/převodovka/karoserie
  (`enums.ts`), převod ceny na CZK podle kurzu ČNB (`currency.ts`).
- **Deduplikace** (`fingerprint.ts`): VIN, pokud je k dispozici, jinak
  `značka+model+rok+nájezd (zaokrouhleno na 1000 km)+výkon`. Stejný
  fingerprint napříč zdroji → stejné `group_id`, ve výsledcích se ukazuje
  jako jedno auto s „více nabídkami“.
- **Matcher** (`matcher.ts`): rozhoduje, jestli normalizovaný inzerát
  odpovídá uloženému hledání — používá ho jak runner (nezávisle na tom, co
  zdroj uměl filtrovat na serveru), tak testy.

## Runner (`packages/scrapers/src/runner.ts`)

Pro každý zapnutý zdroj: pro každé zapnuté hledání, které daný zdroj
používá (prázdné `sources[]` = všechny), zavolá adaptér, normalizuje
výsledky, upsertne do `listings` (klíč `source`+`source_id`), při změně ceny
zapíše řádek do `price_history`, spočítá/najde `group_id` podle
fingerprintu, a pro každé hledání ověří shodu přes `matchesSearch` a
upsertne `matches`. Inzeráty neviděné 3+ dny se označí `is_active=false`. Na
konci běhu pošle e-mailový souhrn nových shod (`notified_at is null`) a
označí je jako odeslané.

## Známá omezení / co zbývá

- Žádný adaptér nebyl ověřen proti živému webu (viz tabulka výše) — první
  ostrý běh v GitHub Actions pravděpodobně bude vyžadovat drobné opravy
  selektorů/API tvaru u některých zdrojů.
- `autoscout24`, `havex`, `autoesa`, `skodaplus` jsou jen stuby (vypnuté),
  čekají na někoho, kdo ověří skutečnou strukturu stránky.
- Filtry ve `/results` jsou zatím jen řazení + stav (aktivní/oblíbené/vše) +
  výběr hledání; rozšířené filtrování přímo ve výsledcích (cena/rok/km) lze
  doplnit později stejným způsobem jako formulář hledání.
- „Férová cena“ / štítek „pod cenou“ a upozornění na zlevnění/zmizelé
  inzeráty jsou v `DESIGN.md` označené jako další fáze a nejsou
  implementované.
