# Scrapping auta – návrh aplikace

> Stav: **NÁVRH k odsouhlasení**. Implementaci provede další agent (Sonnet) podle tohoto dokumentu.

## 1. Cíl

Aplikace pravidelně prohledává největší autobazary podle hledání, která si zadám
(značka, model, rok, cena, nájezd, palivo, převodovka…). Výsledky sjednotí do
jednoho seznamu, odstraní duplicity, hlídá změny ceny a pošle upozornění na nové
inzeráty, které odpovídají hledání.

## 2. Zdroje (bazary)

| Priorita | Bazar | Způsob získání dat | Poznámka |
|---|---|---|---|
| 1 | **Sauto.cz** | Interní JSON API, které volá jejich web | Největší v ČR, nejsnazší parsování |
| 1 | **Bazoš.cz** (auto.bazos.cz) | HTML stránky | Jednoduché HTML, hodně soukromých prodejců |
| 1 | **TipCars.com** | HTML stránky | Hodně dealerů |
| 2 | **AutoScout24** (.cz / .de) | HTML + vložený JSON (`__NEXT_DATA__`) | Evropský trh |
| 3 | **Mobile.de** | Playwright (prohlížeč) | Silná ochrana proti botům, jen volitelně |
| 3 | **Autobazar.eu** (SK) | HTML | Volitelně |

Každý bazar je samostatný **adaptér**, takže přidání dalšího = jeden nový soubor.

**Pravidla slušného scrapingu:** max. ~1 požadavek za 2–5 s na doménu, náhodné
zpoždění, respektovat `robots.txt`, stahovat jen výpisy a detail inzerátu,
žádné obcházení přihlášení/captchy. Je to pro osobní použití.

## 3. Technologie

- **Python 3.12**, správa závislostí `uv` (nebo pip + `pyproject.toml`)
- **httpx** (async HTTP) + **selectolax** (rychlé parsování HTML)
- **Playwright** jen pro weby, kde to jinak nejde
- **SQLite** přes **SQLModel/SQLAlchemy** (jeden soubor, žádný server)
- **FastAPI + Jinja2 + HTMX** – jednoduché webové rozhraní bez složitého frontendu
- **APScheduler** – pravidelné spouštění (např. každých 30 min)
- **Typer** – příkazová řádka
- Notifikace: **Telegram bot** a/nebo **e-mail (SMTP)**
- Testy: **pytest** + uložené HTML/JSON ukázky (bez sítě)
- Nasazení: **Docker / docker-compose** (běží na PC, NAS nebo levném VPS)

## 4. Architektura

```
            ┌──────────────┐
  Web UI ──►│  FastAPI app │◄── CLI (typer)
            └──────┬───────┘
                   │
         ┌─────────▼─────────┐     ┌───────────────┐
         │  Scheduler        │────►│ Search runner │
         └───────────────────┘     └──────┬────────┘
                                          │ pro každé hledání × každý bazar
          ┌──────────────┬────────────────┼───────────────┐
          ▼              ▼                ▼               ▼
     SautoAdapter   BazosAdapter   TipcarsAdapter   AutoScoutAdapter …
          └──────────────┴───────┬────────┴───────────────┘
                                 ▼  (sjednocený Listing)
                        Normalizace + deduplikace
                                 ▼
                         SQLite (listings, ceny)
                                 ▼
                     Notifikace (nové / zlevněné)
```

### Rozhraní adaptéru

```python
class SourceAdapter(Protocol):
    name: str                                   # "sauto", "bazos", ...
    async def search(self, query: SearchQuery) -> AsyncIterator[Listing]: ...
    async def fetch_detail(self, url: str) -> Listing | None: ...  # volitelné
```

Adaptér převede `SearchQuery` na parametry konkrétního webu (URL / API), projde
stránkování (limit např. 5 stránek) a vrací sjednocené `Listing` objekty.

## 5. Datový model

**SearchQuery** (moje hledání)
- `id`, `name` („Octavia combi do 300k“), `enabled`
- `make`, `model`, `year_from/to`, `price_from/to` (CZK), `mileage_max`
- `fuel` (benzín/nafta/hybrid/elektro/LPG), `transmission`, `body`
- `keywords` (volitelně, např. „DSG“, „4x4“), `exclude_keywords` („havarované“)
- `sources` (seznam bazarů), `notify` (ano/ne)

**Listing** (inzerát)
- `id`, `source`, `source_id`, `url`, `title`
- `make`, `model`, `year`, `mileage_km`, `price_czk`, `currency_orig`, `price_orig`
- `fuel`, `transmission`, `power_kw`, `body`, `location`, `seller_type` (soukromník/dealer)
- `image_url`, `first_seen`, `last_seen`, `is_active`
- `fingerprint` – pro deduplikaci napříč bazary (značka+model+rok+nájezd zaokr.+cena zaokr.)

**PriceHistory** – `listing_id`, `price_czk`, `seen_at`

**QueryMatch** – vazba `search_query_id` ↔ `listing_id`, `notified_at`

Ceny v EUR se převádějí na CZK podle denního kurzu ČNB.

## 6. Funkce

**MVP (fáze 1–3)**
1. Zadání hledání přes CLI nebo YAML (`searches.yaml`)
2. Scraping Sauto, Bazoš, TipCars
3. Uložení do SQLite, deduplikace, historie cen
4. Výpis výsledků v terminálu a v jednoduchém webu (tabulka, filtry, řazení)
5. Pravidelné spouštění + Telegram/e-mail notifikace na **nové** inzeráty

**Další fáze**
6. AutoScout24, Mobile.de, Autobazar.eu
7. Upozornění na **zlevnění** a na zmizelé (prodané) inzeráty
8. Webové rozhraní pro správu hledání (přidat/upravit/vypnout)
9. Graf historie ceny, „férová cena“ – porovnání s mediánem podobných aut
10. Označit inzerát jako oblíbený / skrytý

## 7. Struktura projektu

```
scrapping_auta/
├── pyproject.toml
├── README.md
├── DESIGN.md
├── searches.example.yaml
├── .env.example            # TELEGRAM_TOKEN, SMTP_*, DB_PATH ...
├── docker-compose.yml
├── src/carhunter/
│   ├── config.py
│   ├── models.py           # SQLModel tabulky + Pydantic schémata
│   ├── db.py
│   ├── http.py             # sdílený klient: rate-limit, retry, User-Agent
│   ├── normalize.py        # sjednocení značek, paliv, převod měn
│   ├── dedup.py
│   ├── runner.py           # spustí hledání přes adaptéry
│   ├── scheduler.py
│   ├── notify/ (telegram.py, email.py)
│   ├── sources/
│   │   ├── base.py
│   │   ├── sauto.py
│   │   ├── bazos.py
│   │   ├── tipcars.py
│   │   └── autoscout24.py
│   ├── web/ (app.py, templates/)
│   └── cli.py
└── tests/
    ├── fixtures/           # uložené HTML/JSON z bazarů
    └── test_*.py
```

## 8. Použití (cílový stav)

```bash
carhunter search add "Octavia RS" --make skoda --model octavia \
    --year-from 2018 --price-to 450000 --fuel benzin
carhunter run            # jednorázově projde všechny bazary
carhunter list --query "Octavia RS" --sort price
carhunter serve          # web na http://localhost:8000 + scheduler
```

## 9. Plán implementace (pro Sonnet)

1. Kostra projektu, `pyproject.toml`, modely, DB, CLI (`search add/list`, `run`)
2. `http.py` (rate-limit, retry) + adaptér **Sauto** + testy na fixturách
3. Adaptéry **Bazoš** a **TipCars** + testy
4. Normalizace, deduplikace, historie cen
5. Notifikace (Telegram, e-mail) jen pro nové shody
6. FastAPI web: tabulka výsledků, filtry, detail s historií ceny
7. Scheduler + Docker
8. Další bazary (AutoScout24, …)

Každý krok = samostatný commit, testy musí projít (`pytest`), lint `ruff`.

## 10. Rizika

- **Změna HTML/API bazaru** rozbije adaptér → testy na fixturách + log chyb
  a upozornění „adaptér X vrátil 0 výsledků“.
- **Blokace (403/captcha)** → nízká frekvence, případně Playwright; nic neobcházet násilím.
- **Podmínky použití** webů → jen osobní, nekomerční použití, žádné přeposílání dat.
