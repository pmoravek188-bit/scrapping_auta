import type { SourceAdapter } from "./adapter.js";
import { sautoAdapter } from "./sources/sauto.js";
import { bazosAdapter } from "./sources/bazos.js";
import { tipcarsAdapter } from "./sources/tipcars.js";
import { carvagoAdapter } from "./sources/carvago.js";
import { dasweltautoAdapter } from "./sources/dasweltauto.js";
import { aaaautoAdapter } from "./sources/aaaauto.js";
import { havexAdapter } from "./sources/havex.js";
import { autoesaAdapter } from "./sources/autoesa.js";
import { skodaplusAdapter } from "./sources/skodaplus.js";
import { autoscout24Adapter } from "./sources/autoscout24.js";
import { autobazarAdapter } from "./sources/autobazar.js";

/** All known adapters, keyed by source id (matches the `sources` table). */
export const ADAPTERS: Record<string, SourceAdapter> = {
  sauto: sautoAdapter,
  bazos: bazosAdapter,
  tipcars: tipcarsAdapter,
  carvago: carvagoAdapter,
  dasweltauto: dasweltautoAdapter,
  aaaauto: aaaautoAdapter,
  havex: havexAdapter,
  autoesa: autoesaAdapter,
  skodaplus: skodaplusAdapter,
  autoscout24: autoscout24Adapter,
  autobazar: autobazarAdapter,
};

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS[id];
}
