import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/** Toggle chip used for checkbox-style filters (fuel, body, transmission, sources). */
export function Chip({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={clsx("chip", active ? "chip-active" : "chip-inactive")}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {label}
    </button>
  );
}
