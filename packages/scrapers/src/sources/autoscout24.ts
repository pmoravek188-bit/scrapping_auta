/**
 * AutoScout24 adapter — UNVERIFIED stub, disabled by default (see supabase
 * seed). AutoScout24's search page is known to embed results in a
 * `__NEXT_DATA__` JSON blob; this stub currently reuses the generic HTML
 * parser (card selectors) as a placeholder and should be rewritten to parse
 * `__NEXT_DATA__` once someone can verify the real payload shape.
 */
import { makeGenericHtmlAdapter } from "./generic-html.js";

export const autoscout24Adapter = makeGenericHtmlAdapter({
  id: "autoscout24",
  baseUrl: "https://www.autoscout24.cz",
  searchPath: "/lst",
  itemSelector: "article[data-guid], .cldt-summary-full-item",
});
