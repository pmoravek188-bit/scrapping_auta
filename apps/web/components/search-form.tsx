"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  BODY_TYPES,
  DRIVE_TYPES,
  FEATURE_GROUPS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VERSION_GROUPS,
  type BodyType,
  type DriveType,
  type FuelType,
  type TransmissionType,
  type MakeOption,
  type ModelOption,
  prettifyModelSlug,
} from "@scrapping-auta/core";
import { saveSearchAndRematch } from "@/app/actions/rematch";
import { BODY_LABELS, FUEL_LABELS, TRANSMISSION_LABELS, DRIVE_LABELS } from "@/lib/format";
import { FUEL_ICONS, BODY_ICONS, TRANSMISSION_ICONS } from "@/lib/icons";
import {
  PRICE_STEPS,
  YEAR_STEPS,
  MILEAGE_STEPS,
  POWER_STEPS,
  formatPriceStep,
  formatMileageStep,
  formatPowerStep,
} from "@/lib/filter-options";
import { Chip } from "@/components/chip";
import { TagInput } from "@/components/tag-input";
import { Toast } from "@/components/toast";

export interface SearchFormValues {
  id?: string;
  name: string;
  make: string;
  model: string;
  year_from: string;
  year_to: string;
  price_from: string;
  price_to: string;
  mileage_max: string;
  fuel: FuelType[];
  transmission: TransmissionType | "";
  body: BodyType[];
  power_min_kw: string;
  keywords: string;
  exclude_keywords: string;
  sources: string[];
  drive: DriveType[];
  features: string[];
  notify: boolean;
  enabled: boolean;
}

export const EMPTY_SEARCH_FORM: SearchFormValues = {
  name: "",
  make: "",
  model: "",
  year_from: "",
  year_to: "",
  price_from: "",
  price_to: "",
  mileage_max: "",
  fuel: [],
  transmission: "",
  body: [],
  power_min_kw: "",
  keywords: "",
  exclude_keywords: "",
  sources: [],
  drive: [],
  features: [],
  notify: true,
  enabled: true,
};

function toIntOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function SearchForm({
  initial,
  availableSources,
  makes,
  makeModels,
}: {
  initial: SearchFormValues;
  availableSources: { id: string; name: string }[];
  makes: MakeOption[];
  makeModels: Record<string, ModelOption[]>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SearchFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [keywordTags, setKeywordTags] = useState<string[]>(toList(initial.keywords));
  const [excludeTags, setExcludeTags] = useState<string[]>(toList(initial.exclude_keywords));
  const [moreOpen, setMoreOpen] = useState(
    keywordTags.length > 0 || excludeTags.length > 0
  );

  const makeOptions = useMemo<MakeOption[]>(() => {
    if (values.make && !makes.some((m) => m.slug === values.make)) {
      return [...makes, { slug: values.make, label: prettifyModelSlug(values.make) }].sort(
        (a, b) => a.label.localeCompare(b.label, "cs")
      );
    }
    return makes;
  }, [values.make, makes]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const list = values.make ? (makeModels[values.make] ?? []) : [];
    if (values.model && !list.some((m) => m.slug === values.model)) {
      return [...list, { slug: values.model, label: prettifyModelSlug(values.model) }].sort(
        (a, b) => a.label.localeCompare(b.label, "cs")
      );
    }
    return list;
  }, [values.make, values.model, makeModels]);

  function toggleArrayValue<T extends string>(
    field: "fuel" | "body" | "sources" | "drive" | "features",
    value: T
  ) {
    setValues((prev) => {
      const list = prev[field] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [field]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const result = await saveSearchAndRematch({
      id: values.id,
      name: values.name || "Bez názvu",
      enabled: values.enabled,
      notify: values.notify,
      make: values.make || null,
      model: values.model || null,
      year_from: toIntOrNull(values.year_from),
      year_to: toIntOrNull(values.year_to),
      price_from: toIntOrNull(values.price_from),
      price_to: toIntOrNull(values.price_to),
      mileage_max: toIntOrNull(values.mileage_max),
      fuel: values.fuel,
      transmission: values.transmission || null,
      body: values.body,
      power_min_kw: toIntOrNull(values.power_min_kw),
      keywords: keywordTags,
      exclude_keywords: excludeTags,
      sources: values.sources,
      drive: values.drive,
      features: values.features,
    });

    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Uložení se nezdařilo.");
      return;
    }

    setToast(
      `Hledání uloženo · nalezeno ${result.matchCount ?? 0} aut` +
        (result.scrapeTriggered ? " · spuštěno stahování nových" : "")
    );
    router.refresh();
    setTimeout(() => router.push("/searches"), 1200);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="card space-y-4">
        <div>
          <label className="label">Název hledání</label>
          <input
            className="input"
            required
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            placeholder="např. Octavia combi do 400k"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Značka</label>
            <select
              className="input"
              value={values.make}
              onChange={(e) => setValues((v) => ({ ...v, make: e.target.value, model: "" }))}
            >
              <option value="">Všechny značky</option>
              {makeOptions.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Model</label>
            <select
              className="input"
              value={values.model}
              disabled={!values.make}
              onChange={(e) => setValues((v) => ({ ...v, model: e.target.value }))}
            >
              <option value="">{values.make ? "Všechny modely" : "Nejprve vyberte značku"}</option>
              {modelOptions.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="section-title">Rok, cena, nájezd, výkon</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StepSelect
            label="Rok od"
            value={values.year_from}
            onChange={(v) => setValues((s) => ({ ...s, year_from: v }))}
            options={YEAR_STEPS}
            format={(v) => String(v)}
            placeholder="Neomezeno"
          />
          <StepSelect
            label="Rok do"
            value={values.year_to}
            onChange={(v) => setValues((s) => ({ ...s, year_to: v }))}
            options={YEAR_STEPS}
            format={(v) => String(v)}
            placeholder="Neomezeno"
          />
          <StepSelect
            label="Cena od"
            value={values.price_from}
            onChange={(v) => setValues((s) => ({ ...s, price_from: v }))}
            options={PRICE_STEPS}
            format={formatPriceStep}
            placeholder="Neomezeno"
          />
          <StepSelect
            label="Cena do"
            value={values.price_to}
            onChange={(v) => setValues((s) => ({ ...s, price_to: v }))}
            options={PRICE_STEPS}
            format={formatPriceStep}
            placeholder="Neomezeno"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StepSelect
            label="Nájezd do"
            value={values.mileage_max}
            onChange={(v) => setValues((s) => ({ ...s, mileage_max: v }))}
            options={MILEAGE_STEPS}
            format={formatMileageStep}
            placeholder="Neomezeno"
          />
          <StepSelect
            label="Výkon od"
            value={values.power_min_kw}
            onChange={(v) => setValues((s) => ({ ...s, power_min_kw: v }))}
            options={POWER_STEPS}
            format={formatPowerStep}
            placeholder="Neomezeno"
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="section-title">Palivo, karoserie, převodovka</h2>
        <div>
          <label className="label">Palivo</label>
          <div className="flex flex-wrap gap-2">
            {FUEL_TYPES.map((f) => (
              <Chip
                key={f}
                active={values.fuel.includes(f)}
                onClick={() => toggleArrayValue("fuel", f)}
                label={FUEL_LABELS[f] ?? f}
                icon={FUEL_ICONS[f]}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Karoserie</label>
          <div className="flex flex-wrap gap-2">
            {BODY_TYPES.map((b) => (
              <Chip
                key={b}
                active={values.body.includes(b)}
                onClick={() => toggleArrayValue("body", b)}
                label={BODY_LABELS[b] ?? b}
                icon={BODY_ICONS[b]}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Převodovka</label>
          <div className="flex flex-wrap gap-2">
            <Chip
              active={values.transmission === ""}
              onClick={() => setValues((v) => ({ ...v, transmission: "" }))}
              label="Nerozhoduje"
            />
            {TRANSMISSION_TYPES.map((t) => (
              <Chip
                key={t}
                active={values.transmission === t}
                onClick={() => setValues((v) => ({ ...v, transmission: t }))}
                label={TRANSMISSION_LABELS[t] ?? t}
                icon={TRANSMISSION_ICONS[t]}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="section-title">Pohon a verze</h2>
        <div>
          <label className="label">Pohon</label>
          <div className="flex flex-wrap gap-2">
            {DRIVE_TYPES.map((d) => (
              <Chip
                key={d}
                active={values.drive.includes(d)}
                onClick={() => toggleArrayValue("drive", d)}
                label={DRIVE_LABELS[d] ?? d}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Verze</label>
          <div className="flex flex-wrap gap-2">
            {VERSION_GROUPS.map((g) => (
              <Chip
                key={g.id}
                active={values.features.includes(g.id)}
                onClick={() => toggleArrayValue("features", g.id)}
                label={g.label}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">Výbava</h2>
        <div className="flex flex-wrap gap-2">
          {FEATURE_GROUPS.map((g) => (
            <Chip
              key={g.id}
              active={values.features.includes(g.id)}
              onClick={() => toggleArrayValue("features", g.id)}
              label={g.label}
            />
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">Zdroje</h2>
        <p className="text-xs text-gray-500">Nic nezaškrtnuto = hledat na všech dostupných zdrojích.</p>
        <div className="flex flex-wrap gap-2">
          {availableSources.map((s) => (
            <Chip
              key={s.id}
              active={values.sources.includes(s.id)}
              onClick={() => toggleArrayValue("sources", s.id)}
              label={s.name}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="section-title">Další možnosti</span>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${moreOpen ? "rotate-180" : ""}`}
          />
        </button>
        {moreOpen && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="label">Musí obsahovat</label>
              <TagInput values={keywordTags} onChange={setKeywordTags} placeholder="např. nehavarovaná" />
            </div>
            <div>
              <label className="label">Nesmí obsahovat</label>
              <TagInput values={excludeTags} onChange={setExcludeTags} placeholder="např. havarovaná" />
            </div>
          </div>
        )}
      </div>

      <div className="card flex items-center justify-between">
        <label className="label mb-0" htmlFor="notify">
          Upozorňovat e-mailem na nové nabídky
        </label>
        <input
          id="notify"
          type="checkbox"
          checked={values.notify}
          onChange={(e) => setValues((v) => ({ ...v, notify: e.target.checked }))}
          className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        />
      </div>

      <div className="flex gap-3">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Ukládám…" : "Uložit hledání"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push("/searches")}>
          Zrušit
        </button>
      </div>
    </form>
  );
}

function StepSelect({
  label,
  value,
  onChange,
  options,
  format,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: number[];
  format: (v: number) => string;
  placeholder: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
