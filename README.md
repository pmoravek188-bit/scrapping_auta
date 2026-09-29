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
- **Scraper**: TypeScript běžící v GitHub Actions (cron `0 5 * * *` = jednou denně v 7:00 letního času +
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
3. … a dál všechny další soubory v `supabase/migrations/` podle názvu
   (data/čas v názvu = pořadí), včetně `20260928220000_favorites.sql`
   (tabulka `favorites`, viz „Oblíbené“) a `20260928230000_gone_listings.sql`
   (sloupec `listings.gone_at`, viz „Smazané inzeráty“)

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
   - volitelně `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_REF` — viz
     „Ruční spuštění scraperu z webu“ níže; bez nich web dál funguje, jen
     tlačítko „Spustit scraping“ zůstane neaktivní.
4. Deploy. Vercel Hobby stačí — web je čistě čtecí/zápisové UI nad Supabase
   plus jedna malá server-side route (`/api/scrape`) pro ruční spuštění
   scraperu, kromě `/auth/callback`.

## Ruční spuštění scraperu z webu

Stránka „Zdroje“ (a přehled) má tlačítko **Spustit scraping**, které přes
server-side route `apps/web/app/api/scrape/route.ts` zavolá GitHub REST API
(`POST /repos/{repo}/actions/workflows/scrape.yml/dispatches`) a spustí
workflow `scrape.yml` mimo pravidelný cron. Route vyžaduje přihlášeného
uživatele (ověřeno přes Supabase session na serveru — middleware cestu
`/api/*` nechrání, takže kontrola je uvnitř route) a token se nikdy neposílá
do prohlížeče.

Nastavení:

1. Na GitHubu vytvořte **fine-grained personal access token** omezený jen na
   repozitář `pmoravek188-bit/scrapping_auta`:
   - **Settings → Developer settings → Personal access tokens → Fine-grained
     tokens → Generate new token**
   - **Repository access**: Only select repositories → vyberte tento repozitář
   - **Permissions**: `Actions` → **Read and write**, `Metadata` → **Read**
     (přidá se automaticky)
2. V nastavení Vercel projektu (Environment Variables, prostředí
   **Production**) přidejte:
   - `GITHUB_DISPATCH_TOKEN` — vygenerovaný token z kroku 1 (server-only,
     **ne** `NEXT_PUBLIC_*`)
   - `GITHUB_REPO` — výchozí `pmoravek188-bit/scrapping_auta`, není nutné
     nastavovat, pokud sedí
   - `GITHUB_REF` — větev, na které se má `scrape.yml` spustit (výchozí
     `claude/car-search-app-y4b753`)
3. Redeploy. Tlačítko pak spustí scraping pro všechny zdroje nebo jen pro
   vybraný, ukazuje stav běžícího workflow (dotazuje se každých ~10 s) a po
   dokončení obnoví stránku. `scrape.yml` má `concurrency: group: scrape`,
   takže se souběžné běhy nespouští — nový poběží až po dokončení předchozího.

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

Workflow `scrape.yml` běží jednou denně v 05:00 UTC (`workflow_dispatch` navíc
umožňuje ruční spuštění, volitelně jen pro jeden zdroj) a zároveň drží
Supabase free projekt aktivní (jinak po týdnu nečinnosti pauzuje).

## Ověřené vs. neověřené adaptéry zdrojů

Všech 10 adaptérů bylo **ověřeno proti živému webu 2026-09-28** (curl s
reálným Chrome User-Agentem a `Accept-Language: cs-CZ`). Detailní poznámky
k tomu, co bylo na daném webu potvrzeno (přesný tvar URL/API, pole v
odpovědi, co se nepodařilo ověřit) jsou v komentáři na začátku každého
souboru `packages/scrapers/src/sources/<id>.ts`. Parsování zůstává
defenzivní (zod `safeParse` / tolerantní selektory, tiché přeskočení
nevalidní položky, log počtu nalezených inzerátů) a otestované proti
fixturám (reálné, ořezané ukázky uložené z živého webu) v
`packages/scrapers/test/fixtures/`.

| Zdroj | Stav | Zdroj dat / server-side filtry | Poznámka |
|---|---|---|---|
| `sauto` | zapnuto, ověřeno | JSON API `sauto.cz/api/v1/items/search?category_id=838`; filtry: značka/model, cena, nájezd, rok, palivo, převodovka, částečně karoserie, výkon | `power` (kW) skoro nikdy není na výpisu, jen na detailu — `powerKw` bývá `null` |
| `bazos` | zapnuto, ověřeno | HTML `auto.bazos.cz`; rubrika podle značky (`/skoda/`, …) = filtr jen na osobní auta, + `hledat`/`cenaod`/`cenado`, stránkování `crp` | rok/km/palivo/převodovka se parsují z volného textu titulku+popisu — u stručných inzerátů (bez roku/km v textu) zůstanou `null`, hledání s filtrem na rok/km takové inzeráty přeskočí |
| `tipcars` | zapnuto, ověřeno | HTML `tipcars.com/ojete/<značka>-<model>` (JSON-LD `ItemList`); cena/rok/km filtry na serveru nefungují (jen klientský matcher) | rok/km/výkon se čtou z `data-measure-data-value` atributu karty, ne z JSON-LD |
| `carvago` | zapnuto, ověřeno | JSON v `__NEXT_DATA__` na `carvago.com/cs/auta/<značka>/<model>`; filtry: cena, nájezd, rok registrace, výkon, palivo/převodovka/karoserie (přes tag `const_key`) | výhradně dealeři (import ze zahraničí) |
| `dasweltauto` | zapnuto, ověřeno | JSON API `dasweltauto.cz/api/locales/cs_CZ/vehicles/search/`; filtry: značka (`brands`), cena, rok registrace, nájezd | — |
| `aaaauto` | zapnuto, ověřeno | JSON-LD `@graph`/`ItemList` na `aaaauto.cz/ojete-vozy/<značka>/<model>`; filtry: cena, rok, nájezd (jen 2 hodnoty karoserie ověřeny) | výhradně dealer AAA AUTO |
| `havex` | **nově zapnuto** touto migrací, ověřeno | HTML `havex.cz/cz/ojete-vozy-<skoda\|seat\|cupra>`; filtr jen značka (přes cestu), cena/rok/km jen klientský matcher | prodává jen Škoda/Seat/Cupra |
| `autoesa` | **nově zapnuto** touto migrací, ověřeno | HTML `autoesa.cz/<značka>` nebo `/vsechna-auta`; filtr jen značka (přes cestu), cena/rok/km jen klientský matcher | — |
| `skodaplus` | **nově zapnuto** touto migrací, ověřeno | GraphQL `skodaplus.cz/graphql` (`cars(filter: CarFilterInput)`); filtry: značka (`carMakes` id), cena, rok registrace, nájezd | přes branding "Škoda Plus" prodává i jiné značky VW koncernu (ověřeno na Audi) |
| `autoscout24` | zapnuto touto migrací (jen Německo) | JSON v `__NEXT_DATA__` na `autoscout24.cz/lst/<značka>/<model>?cy=D`; filtry: značka/model, rok, nájezd, cena (CZK→EUR podle `eurCzkRate`, zaokrouhleno směrem ven) | **záměrně jen zahraniční (německý) inventář** — `autoscout24.cz` nemá žádné tuzemské inzeráty vůbec (`cy=CZ` dává 0 výsledků); zobrazená cena (`priceRaw`) je vždy cena včetně DPH (brutto) — u inzerátů s `isVatLabelLegallyRequired` (DPH je odpočitatelná pro firmy) se cena **nepřepočítává**, jen se do titulku přidá „· odpočet DPH“ |

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

## Výsledky (`/results`): scope, okamžitý rematch, „NOVÉ“

### Scope výsledků

`/results` má přepínač scope nahoře:

- **„Všechna auta“** (výchozí) — prochází přímo `public.listings` (všechny
  aktivní inzeráty), bez ohledu na to, jestli mají uložené hledání.
- **„Moje hledání: `<název>`“** — jedna záložka na každé uložené hledání,
  ukazuje jen jeho `matches` (se stavem různým od `hidden`).

Obě scope běží přes jednu security-invoker RPC funkci
`public.search_listings` (viz migrace
`supabase/migrations/20260928200000_results_rework.sql`), která v jednom
dotazu:

- aplikuje všechny DB-bezpečné filtry (značka/model přes normalizovaný slug
  včetně prefix-matche na model, `price_czk`/`year`/`mileage_km`/`power_kw`
  rozsahy, `fuel`/`body`/`transmission`/`sources`/`drive` seznamy —
  fuel/body/transmission jsou null-tolerantní stejně jako
  `packages/core`'s `matchesSearch`, `drive` je striktní),
  a pro chip filtry "Výbava"/"Verze" jen OR-ILIKE prefiltr (viz níže),
- deduplikuje podle `group_id` (jedna karta na skupinu, nejlevnější nabídka,
  počet ostatních nabídek jako `group_offer_count` → badge „více nabídek
  (N)“),
- označí `is_new` (viz sekce „NOVÉ“ níže),
- seřadí a stránkuje (30 na stránku, „Předchozí“/„Načíst další“ odkazy na
  `?page=N`) s přesným `count(*) over()`.

**Omezení textového filtrování**: whole-token porovnání (`packages/core`'s
`text-match.ts`/`hasAllFeatures`) nejde levně vyjádřit v SQL. RPC parametr
`p_text_terms` je jen OR-spojený `ILIKE` prefiltr přes všechny synonyma
zaškrtnutých „Výbava“/„Verze“ chipů; `apps/web/app/results/page.tsx` pak nad
vrácenou stránkou ještě spustí přesnou whole-token kontrolu
(`hasAllFeatures`, AND napříč zaškrtnutými chips). Při 2+ zaškrtnutých
chipech to může legitimně vrátit méně než 30 karet na stránku a
`total_count`/počet stránek je pak horní odhad, ne přesné číslo (v UI
označeno „(přibližně)“) — přesné řešení by vyžadovalo whole-token matching
přímo v Postgresu (např. přes `tsvector`/regex), což je mimo rozsah této
migrace.

### Okamžitý rematch (uložení/úprava hledání)

Uložení hledání (`/searches/new`, `/searches/[id]/edit`, i „Uložit jako
hledání“ na `/results`) jde přes server akci
`apps/web/app/actions/rematch.ts#saveSearchAndRematch`, běžící s Supabase
session přihlášeného uživatele (ne `service_role`):

1. Uloží/aktualizuje řádek v `searches`.
2. `rematchSearch`: DB-side prefiltr aktivních inzerátů podle
   značky/modelu/ceny/roku, pak přesný `matchesSearch` (`packages/core`) v
   kódu — stejná funkce jako v `packages/scrapers/src/runner.ts`. Nově
   odpovídající inzeráty se vloží do `matches` **s `notified_at = now()`**,
   takže e-mailový digest (`packages/scrapers/src/runner.ts`, posílá jen
   `matches` kde `notified_at is null`) je znovu nepošle — uživatel je právě
   viděl okamžitě na webu. Řádky `matches`, které už neodpovídají upravenému
   hledání, se smažou.
3. `maybeAutoTriggerScrape` (`apps/web/lib/scrape-trigger.server.ts`, sdíleno
   s `/api/scrape`): pokud je nastaven `GITHUB_DISPATCH_TOKEN` a žádný běh
   `scrape.yml` není `queued`/`in_progress`, spustí nový běh, aby se do
   hledání brzy dostaly i úplně nové inzeráty ze zdrojů.

Toast po uložení: „Hledání uloženo · nalezeno X aut · spuštěno stahování
nových“ (poslední část jen když se scraping opravdu spustil).

**RLS**: `public.matches` mělo z `20260928120000_init.sql` jen
select/update politiky pro vlastníka (řádky dřív zapisoval jen
`service_role` runner). Protože rematch teď zapisuje jako přihlášený
uživatel, `20260928200000_results_rework.sql` přidává
`matches_insert_own`/`matches_delete_own_rematch`, obě podmíněné `exists
(select 1 from public.searches s where s.id = search_id and s.user_id =
(select auth.uid()))` — uživatel může vkládat/mazat jen matches svých
vlastních hledání.

### „NOVÉ“ a „Zlevněno“

`public.user_state` (jeden řádek na uživatele, vlastní-only RLS) drží dva
časy:

- `results_seen_prev` — vodítko, proti kterému se počítá „NOVÉ“
  (`first_seen > results_seen_prev` ve scope „Všechna auta“, `matches.matched_at
  > results_seen_prev` ve scope hledání).
- `results_seen_at` — kdy začala aktuální návštěva.

Při každé návštěvě `/results` (`apps/web/app/actions/user-state.ts#touchResultsSeen`):
pokud je `results_seen_at` starší než 30 minut, `results_seen_prev` se
posune na starou hodnotu `results_seen_at` a `results_seen_at` na teď — jinak
se nic neposouvá, takže badge „NOVÉ“ vydrží celé jedno prohlížení (ne
zmizí hned po refresh). Tlačítko „Označit vše jako viděné“ obě hodnoty
okamžitě sjednotí na teď.

Zelený badge „NOVÉ“ je na kartě první (vlevo), chip „Jen nové“ ve filtrech
filtruje jen na `is_new`. Badge „Zlevněno“ (žlutá) se počítá z posledních
dvou záznamů `price_history` pro danou kartu (nejlevnější/aktuální nabídku
skupiny). Nav položka „Výsledky“ má počítadlo (`public.new_matches_count`
RPC) — počet `matches` napříč všemi hledáními uživatele novějších než jeho
`results_seen_prev`.

## Runner (`packages/scrapers/src/runner.ts`)

Pro každý zapnutý zdroj: pro každé zapnuté hledání, které daný zdroj
používá (prázdné `sources[]` = všechny), zavolá adaptér a normalizuje
výsledky. Z normalizovaných inzerátů se přes `selectListingsToStore`
(`packages/scrapers/src/selection.ts`) vyberou jen ty, které odpovídají
aspoň jednomu z těchto hledání (`matchesSearch`) — jen ty se dál upsertují
do `listings` (klíč `source`+`source_id`), při změně ceny se jim zapíše
řádek do `price_history`, spočítá/najde se jim `group_id` podle
fingerprintu a upsertne `matches`. V `--dry-run` se loguje jak počet
nalezených, tak počet těch, co by se uložily (viz „Co se ukládá do
databáze“ níže). Po každém zdroji se navíc ověří, jestli inzeráty, které
tento běh nenašel, opravdu zmizely ze zdroje — viz „Smazané inzeráty“ níže.
Na konci celého běhu (ne při `--source`) se navíc smažou inzeráty, které
neodpovídají žádnému hledání a nebyly viděné 3+ dny (`cleanupUnmatchedListings`)
— `price_history`/`matches`/`favorites` mažou kaskádově; oblíbený inzerát se
takto nikdy nesmaže (viz „Oblíbené“ níže). Na úplný závěr pošle e-mailový
souhrn nových shod (`notified_at is null`) a označí je jako odeslané.

### Co se ukládá do databáze

Do databáze (`listings`, `price_history`, `matches`) se ukládají **jen
inzeráty, které odpovídají aspoň jednomu uloženému a zapnutému hledání** —
ne všechno, co scraper na daném zdroji najde. Důvod je prostý: bez filtru by
tabulka `listings` rostla nekontrolovaně počtem inzerátů napříč všemi
bazary, i když je nikdo nikdy neuvidí.

Z toho plynou dvě praktická pravidla:

- **Rozšíření hledání (nový/upravený filtr, přidaný zdroj) se projeví až po
  dalším scrapingu.** Inzeráty, které nově odpovídají rozšířenému hledání,
  ale scraper je dřív zahazoval (protože tehdy neodpovídaly ničemu), se
  objeví až po dalším běhu, kdy si je scraper znovu stáhne ze zdroje a
  tentokrát projdou filtrem. Proto tlačítko „Spustit scraping“ webová
  aplikace **po uložení/úpravě hledání spouští automaticky** (viz
  „Okamžitý rematch“ výše — ten se navíc přes existující `matches` dá
  spočítat okamžitě pro inzeráty, co v DB už jsou, ale nové inzeráty ze
  zdroje potřebují opravdový scraping).
- **Inzerát, který přestane odpovídat všem hledáním (hledání se zúží nebo
  smaže), se dál needituje** — poslední uložený stav (cena, `last_seen`,
  …) zůstane zmrazený, protože ho runner přestane znovu zapisovat. Po 3+
  dnech ho úklid na konci plného běhu (viz výše) smaže i s historií ceny.
  Krátká prodleva 3 dnů je záměrná — aby čerstvě stažený inzerát nezmizel
  hned po úpravě hledání, než se stačí spočítat nový rematch.

## Oblíbené

`/favorites` je samostatný, na hledáních nezávislý seznam — tabulka
`public.favorites` (`supabase/migrations/20260928220000_favorites.sql`,
`user_id`+`listing_id`, RLS jen vlastník). Srdíčko u karty (komponenta
`apps/web/components/favorite-button.tsx`) funguje úplně všude — na
domovské stránce, v obou scope `/results` (i „Všechna auta“, kde předtím
oblíbení nešlo, protože neexistoval řádek v `matches`), i na detailu
inzerátu — a přepíná řádek v `favorites`, ne `matches.status`. Stránka
`/favorites` navíc umí:

- poznámku k inzerátu (`favorites.note`, editace přímo na kartě),
- změnu ceny od přidání (první záznam v `price_history` od `created_at`
  dál, porovnaný s aktuální cenou),
- štítek „Nedostupné / prodáno“, když `listings.is_active = false`,
- řazení podle data přidání nebo ceny,
- odebrání z oblíbených.

Stará logika `matches.status = 'favorite'` byla plně nahrazena (migrace ji
při aplikaci jednorázově přenese do `favorites`); `matches.status = 'hidden'`
(„Skrýt nabídku“) zůstává beze změny — pořád vyžaduje řádek v `matches`, a
proto je dostupné jen ve scope „Moje hledání“.

Scraper (`packages/scrapers/src/runner.ts`) nikdy nesmaže oblíbený inzerát
(`cleanupUnmatchedListings` ho přeskočí i po 3+ dnech bez shody) a i
smazaný/prodaný oblíbený inzerát se jen deaktivuje, ne smaže rovnou — viz
„Smazané inzeráty“ níže. Runner jinak dál upsertuje jen inzeráty, které
aktuálně odpovídají nějakému hledání — oblíbený inzerát, který přestal
odpovídat všem hledáním, si tedy podrží svůj poslední známý stav (cenu,
`last_seen`, …), dokud ho zdroj sám nesmaže.

## Smazané inzeráty

Dřívější logika „neviděno 3+ dny → `is_active=false`“ byla nahrazena
ověřeným mazáním: po každém zdroji (`checkGoneListings` v
`packages/scrapers/src/runner.ts`) se pro inzeráty daného zdroje, které
tento běh nenašel, ověří, jestli už opravdu na zdroji neexistují —
teprve pak se s nimi něco udělá:

1. **Kandidát**: aktivní inzerát daného zdroje (`is_active=true`,
   `gone_at is null`), který nebyl mezi touto dávkou stažených výsledků. Bere
   se v potaz jen když se zdroji tento běh podařilo něco stáhnout bez chyby
   (jinak by "nenašel" mohlo jen znamenat, že zdroj zrovna nejde). Kvůli
   časovému rozpočtu běhu se na zdroj kontroluje nejvýš 50 kandidátů za běh
   (`MAX_GONE_CHECKS_PER_SOURCE`) — zbytek se zkusí příští běh.
2. **Potvrzení**: stáhne se detail inzerátu (`fetchForGoneCheck`, přes
   stejný zdvořilý/throttlovaný `politeFetch` jako cokoliv jiného) a
   vyhodnotí se `isGone()` z `packages/scrapers/src/gone-detection.ts` — 404/410,
   přesměrování pryč z tvaru detailní URL (adaptér-specifické: `sauto`
   mimo `/osobni/detail/…`, `tipcars` mimo `.html`, `bazos` mimo
   `/inzerat/…`), nebo 200 stránka s frází typu „inzerát byl smazán/
   prodán/neexistuje“ (česky/německy/anglicky) — u zdrojů bez vlastního
   pravidla se použije jen tato obecná fráze/stavová kontrola.
3. **Potvrzeně pryč a NENÍ v oblíbených** → inzerát se rovnou smaže
   (`price_history`/`matches`/`favorites` kaskádově).
4. **Potvrzeně pryč a JE v oblíbených** → inzerát zůstává, jen se nastaví
   `is_active=false` a `gone_at=now()`; stránka „Oblíbené“ pak u něj ukáže
   „Prodáno / nedostupné od `<gone_at>`“. Po `GONE_FAVORITE_RETENTION_DAYS`
   (výchozí **7 dní** — konstanta v `runner.ts`, klidně si ji upravte) se
   i takový inzerát smaže (`deleteExpiredGoneFavorites`) — uživatel do té
   doby vidí, že vůz zmizel.
5. **Nepotvrzeno** (síťová chyba, timeout, nebo stránka pořád vypadá jako
   živý inzerát) → inzerát se nechá být a zkusí znovu příští běh.

`--dry-run` nikdy nic nemaže ani neoznačuje — celá tahle logika běží jen
při skutečném zápisu do databáze. Runner loguje za každý zdroj řádek
`checked / gone / deleted / kept-favourite`.

Heuristiky pro `sauto`/`tipcars`/`bazos` vycházejí z tvaru jejich detailních
URL (viz komentáře v `gone-detection.ts`), ale nebyly ověřeny živě proti
skutečně smazanému inzerátu (žádný nebyl po ruce k otestování) — berte je
jako rozumný odhad, ne jako 100% ověřené chování jako u zbytku adaptérů.

## Známá omezení / co zbývá

- Všech 10 adaptérů bylo ověřeno proti živému webu 2026-09-28 (viz tabulka
  výše), ale weby se mění — ostrý běh v GitHub Actions může časem vyžadovat
  drobné opravy selektorů/API tvaru; sledujte stránku „Stav zdrojů“ a
  `scrape_runs.errors`.
- `bazos` u stručných inzerátů (bez roku/km v titulku či popisu) nemá odkud
  rok/nájezd vzít — takové inzeráty projdou dál s `year`/`mileageKm` `null`
  a hledání s aktivním filtrem na rok/km je proto vynechá.
- `autoscout24` je záměrně jen německý inventář (`cy=D`) — `autoscout24.cz`
  nemá žádné tuzemské (CZ) inzeráty vůbec. Ceny jsou v EUR a runner je
  převádí na CZK; zobrazená cena je vždy včetně DPH (brutto) — u inzerátů,
  kde je DPH odpočitatelná pro firmy (`isVatLabelLegallyRequired`), se cena
  nijak nepřepočítává, jen se to označí „· odpočet DPH“ v titulku.
- „Férová cena“ / štítek „pod cenou“ a upozornění na zmizelé inzeráty jsou v
  `DESIGN.md` označené jako další fáze a nejsou implementované (badge
  „Zlevněno“ pro pokles ceny už ano, viz sekce výsledků výše).
- Textové filtrování (chipy „Výbava“/„Verze“) ve scope `/results` je jen
  OR-ILIKE prefiltr v SQL + přesný whole-token check v kódu nad vrácenou
  stránkou — u 2+ zaškrtnutých chipů proto `total_count`/počet stránek může
  být jen horní odhad (viz „Omezení textového filtrování“ výše).
- Skrýt nabídku funguje jen ve scope „Moje hledání“ (potřebuje řádek v
  `matches`, který v scope „Všechna auta“ neexistuje, dokud se inzerát
  nestane součástí nějakého uloženého hledání) — v scope „Všechna auta“ se
  toto tlačítko u karty nezobrazuje. Oblíbit funguje všude (viz „Oblíbené“
  výše) — je to samostatná tabulka, ne řádek v `matches`.
- `new_matches_count` (počítadlo u „Výsledky“ v navigaci) se dotazuje přes
  klientský Supabase klient při každé změně route; u velmi aktivního účtu
  s desítkami hledání by šlo do budoucna nahradit realtime subscription
  místo pollování při navigaci.
