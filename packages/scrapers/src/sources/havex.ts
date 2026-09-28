/** Havex.cz adapter — UNVERIFIED stub, disabled by default (see supabase seed). */
import { makeGenericHtmlAdapter } from "./generic-html.js";

export const havexAdapter = makeGenericHtmlAdapter({
  id: "havex",
  baseUrl: "https://www.havex.cz",
  searchPath: "/vozy",
  itemSelector: ".car-item, .vehicle-card",
});
