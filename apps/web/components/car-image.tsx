"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import clsx from "clsx";

/**
 * Renders a listing photo with a graceful fallback to the "no image" icon
 * if it fails to load (dead URL, hotlink protection, etc). Needs
 * `onError`, a DOM event handler, so it must be a Client Component — the
 * callers (`car-card.tsx`, `listing-gallery.tsx`) render as Server
 * Components on some pages and can't attach one directly.
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
      onError={() => setFailed(true)}
    />
  );
}
