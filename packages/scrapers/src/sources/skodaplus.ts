/** Škoda Plus (skodaplus.cz) adapter — UNVERIFIED stub, disabled by default (see supabase seed). */
import { makeGenericHtmlAdapter } from "./generic-html.js";

export const skodaplusAdapter = makeGenericHtmlAdapter({
  id: "skodaplus",
  baseUrl: "https://www.skodaplus.cz",
  searchPath: "/vyhledavani",
  itemSelector: ".car-item, .vehicle-card",
});
