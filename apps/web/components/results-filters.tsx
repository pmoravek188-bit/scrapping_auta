"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BODY_TYPES,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  type BodyType,
  type FuelType,
  type TransmissionType,
  type MakeOption,
  type ModelOption,
  prettifyModelSlug,
} from "@scrapping-auta/core";
import { BODY_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";
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

export interface ResultsFilterValues {
  make: string;
  model: string;
  price_from: string;
  price_to: string;
  year_from: string;
  year_to: string;
  mileage_max: string;
  power_min_kw: string;
  fuel: FuelType[];
  body: BodyType[];
  transmission: TransmissionType | "";
  sources: string[];
}

/** Shared filter form used both in the desktop sidebar and the mobile drawer
 * on /results. Applying filters rewrites the page's query string, keeping
 * `search`, `sort` and `status` untouched. */
export function ResultsFilters({
  initial,
  makes,
  makeModels,
  availableSources,
  extraParams,
  onApplied,
}: {
  initial: ResultsFilterValues;
  makes: MakeOption[];
  makeModels: Record<string, ModelOption[]>;
  availableSources: { id: string; name: string }[];
  extraParams: Record<string, string | undefined>;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ResultsFilterValues>(initial);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const list = values.make ? (makeModels[values.make] ?? []) : [];
    if (values.model && !list.some((m) => m.slug === values.model)) {
      return [...list, { slug: values.model, label: prettifyModelSlug(values.model) }].sort(
        (a, b) => a.label.localeCompare(b.label, "cs")
      );
    }
    return list;
  }, [values.make, values.model, makeModels]);

  function toggle<T extends string>(field: "fuel" | "body" | "sources", value: T) {
    setValues((prev) => {
      const list = prev[field] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [field]: next };
    });
  }

  function apply() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) params.set(k, v);
    }
    if (values.make) params.set("make", values.make);
    if (values.model) params.set("model", values.model);
    if (values.price_from) params.set("price_from", values.price_from);
    if (values.price_to) params.set("price_to", values.price_to);
    if (values.year_from) params.set("year_from", values.year_from);
    if (values.year_to) params.set("year_to", values.year_to);
    if (values.mileage_max) params.set("mileage_max", values.mileage_max);
    if (values.power_min_kw) params.set("power_min_kw", values.power_min_kw);
    if (values.transmission) params.set("transmission", values.transmission);
    for (const f of values.fuel) params.append("fuel", f);
    for (const b of values.body) params.append("body", b);
    for (const s of values.sources) params.append("sources", s);
    router.push(`/results?${params.toString()}`);
    router.refresh();
    onApplied?.();
  }

  function reset() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) params.set(k, v);
    }
    router.push(`/results?${params.toString()}`);
    onApplied?.();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Značka</label>
          <select
            className="input"
            value={values.make}
            onChange={(e) => setValues((v) => ({ ...v, make: e.target.value, model: "" }))}
          >
            <option value="">Všechny</option>
            {makes.map((m) => (
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
            <option value="">Všechny</option>
            {modelOptions.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Cena od"
          value={values.price_from}
          onChange={(v) => setValues((s) => ({ ...s, price_from: v }))}
          options={PRICE_STEPS}
          format={formatPriceStep}
        />
        <SelectField
          label="Cena do"
          value={values.price_to}
          onChange={(v) => setValues((s) => ({ ...s, price_to: v }))}
          options={PRICE_STEPS}
          format={formatPriceStep}
        />
        <SelectField
          label="Rok od"
          value={values.year_from}
          onChange={(v) => setValues((s) => ({ ...s, year_from: v }))}
          options={YEAR_STEPS}
          format={(v) => String(v)}
        />
        <SelectField
          label="Rok do"
          value={values.year_to}
          onChange={(v) => setValues((s) => ({ ...s, year_to: v }))}
          options={YEAR_STEPS}
          format={(v) => String(v)}
        />
        <SelectField
          label="Nájezd do"
          value={values.mileage_max}
          onChange={(v) => setValues((s) => ({ ...s, mileage_max: v }))}
          options={MILEAGE_STEPS}
          format={formatMileageStep}
        />
        <SelectField
          label="Výkon od"
          value={values.power_min_kw}
          onChange={(v) => setValues((s) => ({ ...s, power_min_kw: v }))}
          options={POWER_STEPS}
          format={formatPowerStep}
        />
      </div>

      <div>
        <label className="label">Palivo</label>
        <div className="flex flex-wrap gap-2">
          {FUEL_TYPES.map((f) => (
            <Chip
              key={f}
              active={values.fuel.includes(f)}
              onClick={() => toggle("fuel", f)}
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
              onClick={() => toggle("body", b)}
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

      {availableSources.length > 0 && (
        <div>
          <label className="label">Zdroje</label>
          <div className="flex flex-wrap gap-2">
            {availableSources.map((s) => (
              <Chip
                key={s.id}
                active={values.sources.includes(s.id)}
                onClick={() => toggle("sources", s.id)}
                label={s.name}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" className="btn flex-1" onClick={apply}>
          Použít filtry
        </button>
        <button type="button" className="btn-secondary" onClick={reset}>
          Vymazat
        </button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  format,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: number[];
  format: (v: number) => string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Neomezeno</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
