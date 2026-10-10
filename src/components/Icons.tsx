import {
  Waves, Fan, Gauge, GitBranch, Pipette,
  BatteryCharging,
  Zap,
  Lightbulb,
  ToggleRight,
  Flame,
  Container,
  Earth,
  Shield,
  Activity,
  Box, Move, RotateCw, Cable,
  type LucideIcon,
} from "lucide-react";
import type { Kind } from "../simulation/model";
export const kindIcons: Record<Kind, LucideIcon> = {
  rigidBody: Box, positionSensor: Move, speedSensor: RotateCw, forceActuator: Activity,
  motor: Fan, pump: Waves, pipe: Pipette, valve: ToggleRight, checkValve: Shield,
  actuatedValve: ToggleRight, fluidJunction: GitBranch, pressureSensor: Gauge,
  flowSensor: Activity, levelSensor: Container, pid: Activity,
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
  cable: Cable,
  breaker: Shield,
  motorProtector: Shield,
  thermalMass: Container,
  heatExchanger: GitBranch,
  pressureReducingValve: Gauge,
  scale: Activity,
  limiter: Activity,
  filter: Activity,
  rateLimiter: Activity,
  selector: GitBranch,
  source3: BatteryCharging,
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
