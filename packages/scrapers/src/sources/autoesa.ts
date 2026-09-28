/** Auto ESA (autoesa.cz) adapter — UNVERIFIED stub, disabled by default (see supabase seed). */
import { makeGenericHtmlAdapter } from "./generic-html.js";

export const autoesaAdapter = makeGenericHtmlAdapter({
  id: "autoesa",
  baseUrl: "https://www.autoesa.cz",
  searchPath: "/vozy",
  itemSelector: ".car-item, .vehicle-card",
});
