"use client";

import { useState } from "react";
import clsx from "clsx";
import { resolveImageUrl } from "@scrapping-auta/core";
import { CarImage } from "@/components/car-image";

export function ListingGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const src = resolveImageUrl(images[active], "large");

  return (
    <div>
      <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-gray-100">
        <CarImage src={src} alt={title} className="h-full w-full object-cover" iconClassName="h-12 w-12" />
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img + i}
              type="button"
              onClick={() => setActive(i)}
              className={clsx(
                "h-16 w-20 flex-shrink-0 overflow-hidden rounded-md border-2 transition",
                i === active ? "border-brand-500" : "border-transparent opacity-80 hover:opacity-100"
              )}
            >
              <CarImage src={resolveImageUrl(img, "card")} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
