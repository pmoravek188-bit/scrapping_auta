import {
  Fuel,
  Droplet,
  Zap,
  Leaf,
  BatteryCharging,
  Flame,
  Wind,
  CircleEllipsis,
  Car,
  CarFront,
  Caravan,
  Mountain,
  Bus,
  Truck,
  Sun,
  Users,
  Cog,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import type { FuelType, TransmissionType, BodyType } from "@scrapping-auta/core";

export const FUEL_ICONS: Record<FuelType, LucideIcon> = {
  petrol: Fuel,
  diesel: Droplet,
  electric: Zap,
  hybrid: Leaf,
  plugin_hybrid: BatteryCharging,
  lpg: Flame,
  cng: Wind,
  other: CircleEllipsis,
};

export const BODY_ICONS: Record<BodyType, LucideIcon> = {
  hatchback: Car,
  sedan: CarFront,
  combi: Caravan,
  suv: Mountain,
  coupe: CarFront,
  van: Bus,
  pickup: Truck,
  cabrio: Sun,
  mpv: Users,
  other: CircleEllipsis,
};

export const TRANSMISSION_ICONS: Record<TransmissionType, LucideIcon> = {
  manual: Cog,
  automatic: Settings2,
};
