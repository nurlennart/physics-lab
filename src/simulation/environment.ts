import { projectAmbient, type Component, type Project, type Property } from './model';

export type AmbientSource = 'override' | 'space' | 'experiment';
export interface ResolvedAmbient { temperature: number; source: AmbientSource }

/**
 * Temperatures in °C. The optional containing-space boundary is a future
 * integration point only; no room state, membership or simulation exists yet.
 */
export function resolveAmbient(project: Pick<Project, 'environment'>, component: Component, containingSpaceAmbient?: number): ResolvedAmbient {
  if (component.props.ambientMode === 'override' && typeof component.props.ambient === 'number')
    return { temperature: component.props.ambient, source: 'override' };
  if (containingSpaceAmbient !== undefined)
    return { temperature: containingSpaceAmbient, source: 'space' };
  return { temperature: projectAmbient(project), source: 'experiment' };
}

export const effectiveAmbient = (project: Pick<Project, 'environment'>, component: Component) =>
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
