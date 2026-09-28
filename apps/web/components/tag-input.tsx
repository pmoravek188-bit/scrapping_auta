"use client";

import { useState } from "react";
import { X } from "lucide-react";

/** Type + Enter → chip tag input, used for keyword include/exclude lists. */
export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-2 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
      <div className="flex flex-wrap gap-1.5">
        {values.map((tag) => (
          <span key={tag} className="chip chip-active !cursor-default py-1">
            {tag}
            <button
              type="button"
              aria-label={`Odebrat „${tag}“`}
              onClick={() => onChange(values.filter((v) => v !== tag))}
              className="rounded-full hover:bg-brand-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 border-0 p-1 text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : ""}
        />
      </div>
    </div>
  );
}
