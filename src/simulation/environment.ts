import { projectAmbient, type Component, type Project, type Property } from './model';

export type AmbientSource = 'override' | 'space' | 'experiment';
export interface ResolvedAmbient { temperature: number; source: AmbientSource }
const spaceTemperatures = new WeakMap<object, Record<string, number>>();
/** Runtime boundary context belongs to one engine-owned project; never serialized. */
export function bindSpaceTemperatures(project: object, temperatures: Record<string, number>) { spaceTemperatures.set(project, temperatures); }

/**
 * Temperatures in °C. Membership is explicit; the engine binds accepted or trial
 * zone temperatures without putting runtime state into serialized projects.
 */
export function resolveAmbient(project: Pick<Project, 'environment'>, component: Component, containingSpaceAmbient?: number): ResolvedAmbient {
  if (component.props.ambientMode === 'override' && typeof component.props.ambient === 'number')
    return { temperature: component.props.ambient, source: 'override' };
  containingSpaceAmbient ??= component.thermalSpaceId ? spaceTemperatures.get(project)?.[component.thermalSpaceId] ?? (project as Project).thermalSpaces?.find(s => s.id === component.thermalSpaceId)?.initialTemperature : undefined;
  if (containingSpaceAmbient !== undefined)
    return { temperature: containingSpaceAmbient, source: 'space' };
  return { temperature: projectAmbient(project), source: 'experiment' };
}

/** A Thermal Space's bound (accepted or trial) temperature, °C; its initial temperature before the engine binds any. */
export const spaceTemperature = (project: Project, id: string) =>
  spaceTemperatures.get(project)?.[id] ?? project.thermalSpaces?.find(s => s.id === id)?.initialTemperature ?? projectAmbient(project);

export const effectiveAmbient =(project: Pick<Project, 'environment'>, component: Component) =>
  resolveAmbient(project, component).temperature;

/**
 * Ambient boundary after a catalog variant change. A component still on its previous
 * variant's boundary (same mode and, under override, the same temperature) takes the new
 * variant's boundary. A boundary the user chose (a different mode or override temperature)
 * is kept.
 */
export function variantAmbient(current: Record<string, Property>, previous: Record<string, Property>, next: Record<string, Property>): Record<string, Property> {
  if (!('ambientMode' in next)) return {};
  const customized = current.ambientMode !== previous.ambientMode || (current.ambientMode === 'override' && current.ambient !== previous.ambient);
  return customized ? { ambientMode: current.ambientMode, ambient: current.ambient } : { ambientMode: next.ambientMode, ambient: next.ambient };
}
