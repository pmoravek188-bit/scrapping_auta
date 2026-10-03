"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import clsx from "clsx";
import { useReportImageError } from "@/components/hide-on-image-error";

/**
 * Renders a listing photo with a graceful fallback to the "no image" icon
 * if it fails to load (dead URL, hotlink protection, etc). Needs
 * `onError`, a DOM event handler, so it must be a Client Component — the
 * callers (`car-card.tsx`, `listing-gallery.tsx`) render as Server
 * Components on some pages and can't attach one directly.
 *
 * When rendered inside a `HideOnImageError` wrapper (see that file), a load
 * failure ALSO reports up to it so the whole card can hide itself, in
 * addition to this component's own local placeholder-icon fallback — see
 * car-card.tsx for which pages wrap it and which don't.
 */
export function CarImage({
  src,
  alt,
  className,
  iconClassName,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const reportImageError = useReportImageError();

  if (!src || failed) {
    return (
      <div className={clsx("flex h-full w-full items-center justify-center text-gray-300", className)}>
        <ImageOff className={iconClassName ?? "h-10 w-10"} aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        setFailed(true);
        reportImageError?.();
      }}
    />
  );
}
