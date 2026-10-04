import { ExternalLink, ShieldCheck } from "lucide-react";
import { isValidVinFormat } from "@scrapping-auta/core";

/**
 * "Prověřit VIN" links to third-party vehicle-history checkers, shown on the
 * listing detail page only when the listing has a VIN (most sources don't
 * expose one — see packages/scrapers/src/sources/*.ts). Renders nothing for
 * an invalid/missing VIN.
 *
 * URL patterns verified live (curl, October 2026):
 *   - https://cz.cebia.com/?vin=<VIN>            -> 200, "Kontrola VIN" page
 *   - https://www.carvertical.com/cz/vin-decoder?vin=<VIN> -> 200, "VIN dekodér" page
 * Both are the providers' own VIN-entry pages with the VIN pre-filled via a
 * query param — neither exposes a free full report without payment, but both
 * accept and act on a VIN passed this way.
 */
export function VinCheckLinks({ vin }: { vin: string | null | undefined }) {
  if (!isValidVinFormat(vin)) return null;
  const clean = vin!.trim().toUpperCase();

  const links = [
    { label: "Cebia", href: `https://cz.cebia.com/?vin=${clean}` },
    { label: "carVertical", href: `https://www.carvertical.com/cz/vin-decoder?vin=${clean}` },
  ];

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        VIN: {clean}
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary text-xs"
          >
            Prověřit VIN – {link.label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}
