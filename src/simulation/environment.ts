import { projectAmbient, type Component, type Project } from './model';

export type AmbientSource = 'override' | 'space' | 'experiment';
export interface ResolvedAmbient { temperature: number; source: AmbientSource }

/**
 * Temperatures in °C. The optional containing-space boundary is a future
 * integration point only; no room state, membership or simulation exists yet.
 * Missing mode with a stored ambient is the legacy explicit-boundary format.
 */
export function resolveAmbient(project: Pick<Project, 'environment'>, component: Component, containingSpaceAmbient?: number): ResolvedAmbient {
  if (component.props.ambientMode !== 'inherit' && typeof component.props.ambient === 'number')
    return { temperature: component.props.ambient, source: 'override' };
  if (containingSpaceAmbient !== undefined)
    return { temperature: containingSpaceAmbient, source: 'space' };
  return { temperature: projectAmbient(project), source: 'experiment' };
}

export const effectiveAmbient = (project: Pick<Project, 'environment'>, component: Component) =>
  resolveAmbient(project, component).temperature;
