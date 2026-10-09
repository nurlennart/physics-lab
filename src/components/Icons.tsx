import {
  BatteryCharging,
  Zap,
  Lightbulb,
  ToggleRight,
  Flame,
  Container,
  Earth,
  Shield,
  Activity,
  type LucideIcon,
} from "lucide-react";
import type { Kind } from "../simulation/model";
export const kindIcons: Record<Kind, LucideIcon> = {
  source: BatteryCharging,
  resistor: Zap,
  lamp: Lightbulb,
  switch: ToggleRight,
  heater: Flame,
  tank: Container,
  ground: Earth,
  fuse: Shield,
  meter: Activity,
  sensor: Activity,
  comparator: Activity,
  hysteresis: Activity,
  relay: ToggleRight,
  thermostat: Flame,
  timer: Activity,
  and: Activity,
  or: Activity,
  not: Activity,
  constant: Activity,
  latch: Activity,
  reset: Activity,
  safety: Shield,
  cooler: Container,
  junction: Zap,
};
export function ComponentIcon({
  kind,
  size = 20,
}: {
  kind: Kind;
  size?: number;
}) {
  const Icon = kindIcons[kind];
  return <Icon size={size} strokeWidth={1.6} />;
}
