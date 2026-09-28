"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BODY_TYPES,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  type BodyType,
  type FuelType,
  type TransmissionType,
} from "@scrapping-auta/core";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { BODY_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";

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
}: {
  initial: SearchFormValues;
  availableSources: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<SearchFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleArrayValue<T extends string>(field: "fuel" | "body" | "sources", value: T) {
    setValues((prev) => {
      const list = prev[field] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [field]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Nejste přihlášeni.");
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      name: values.name || "Bez názvu",
      enabled: values.enabled,
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
      keywords: toList(values.keywords),
      exclude_keywords: toList(values.exclude_keywords),
      sources: values.sources,
      notify: values.notify,
    };

    const { error } = values.id
      ? await supabase.from("searches").update(payload).eq("id", values.id)
      : await supabase.from("searches").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/searches");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="card space-y-3">
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
            <label className="label">Značka (slug)</label>
            <input
              className="input"
              value={values.make}
              onChange={(e) => setValues((v) => ({ ...v, make: e.target.value }))}
              placeholder="skoda"
            />
          </div>
          <div>
            <label className="label">Model (slug)</label>
            <input
              className="input"
              value={values.model}
              onChange={(e) => setValues((v) => ({ ...v, model: e.target.value }))}
              placeholder="octavia"
            />
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Rok, cena, nájezd</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="Rok od" value={values.year_from} onChange={(v) => setValues((s) => ({ ...s, year_from: v }))} />
          <NumberField label="Rok do" value={values.year_to} onChange={(v) => setValues((s) => ({ ...s, year_to: v }))} />
          <NumberField label="Cena od (Kč)" value={values.price_from} onChange={(v) => setValues((s) => ({ ...s, price_from: v }))} />
          <NumberField label="Cena do (Kč)" value={values.price_to} onChange={(v) => setValues((s) => ({ ...s, price_to: v }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Max. nájezd (km)" value={values.mileage_max} onChange={(v) => setValues((s) => ({ ...s, mileage_max: v }))} />
          <NumberField label="Min. výkon (kW)" value={values.power_min_kw} onChange={(v) => setValues((s) => ({ ...s, power_min_kw: v }))} />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Palivo, převodovka, karoserie</h2>
        <div>
          <label className="label">Palivo</label>
          <div className="flex flex-wrap gap-2">
            {FUEL_TYPES.map((f) => (
              <Chip
                key={f}
                active={values.fuel.includes(f)}
                onClick={() => toggleArrayValue("fuel", f)}
                label={FUEL_LABELS[f] ?? f}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Převodovka</label>
          <select
            className="input"
            value={values.transmission}
            onChange={(e) =>
              setValues((v) => ({ ...v, transmission: e.target.value as TransmissionType | "" }))
            }
          >
            <option value="">Nerozhoduje</option>
            {TRANSMISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRANSMISSION_LABELS[t] ?? t}
              </option>
            ))}
          </select>
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
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Klíčová slova</h2>
        <div>
          <label className="label">Musí obsahovat (oddělte čárkou)</label>
          <input
            className="input"
            value={values.keywords}
            onChange={(e) => setValues((v) => ({ ...v, keywords: e.target.value }))}
            placeholder="nehavarovaná, servisní kniha"
          />
        </div>
        <div>
          <label className="label">Nesmí obsahovat (oddělte čárkou)</label>
          <input
            className="input"
            value={values.exclude_keywords}
            onChange={(e) => setValues((v) => ({ ...v, exclude_keywords: e.target.value }))}
            placeholder="havarovaná, na náhradní díly"
          />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Zdroje</h2>
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

      <div className="card flex items-center justify-between">
        <div>
          <label className="label mb-0">Upozorňovat e-mailem na nové nabídky</label>
        </div>
        <input
          type="checkbox"
          checked={values.notify}
          onChange={(e) => setValues((v) => ({ ...v, notify: e.target.checked }))}
          className="h-5 w-5"
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}
