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
