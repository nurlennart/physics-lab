import type { Component, Project } from '../model';
import type { Simulation } from '../engine';
import type { ChallengeId } from './ids';

export interface ChallengeResult {
  progress: number;
  complete: boolean;
  failed: boolean;
  stars: number;
  checks: { label: string; ok: boolean }[];
  score: number;
}

/** Locked assignment conditions checked by integrity.ts at import and at every engine boundary. */
export interface ChallengeRules {
  ambient: number;
  initial: number;
  /** Highest supply voltage (V) a purchased source may be set to. */
  maxVoltage: number;
  /** Component kinds the player may place. */
  allowed: readonly string[];
}

/** Text fragment of a live status line; `strong` is emphasized. */
export type StatusPart = string | { strong: string };

/**
 * One scored mission. `State` is the mission's tracking state, created fresh at every reset.
 * Hooks run inside the engine step in this order: beforeStep (before the electrical solve),
 * afterSolve (after it, with the contacts and heater power from before), update (end of step).
 */
export interface ChallengeDefinition<State = unknown> {
  id: ChallengeId;
  number: string;
  title: string;
  difficulty: string;
  description: string;
  objectives: string[];
  /** Card icon and equation. */
  family: 'electrical' | 'thermal' | 'hydraulic' | 'mechanical';
  budget: number;
  /** Reference build cost (€): full economy credit at or below it, declining to zero at the budget. */
  economyTarget: number;
  rules: ChallengeRules;
  /** Engine-wide limits checked every step: peak electrical input (W) and peak supply voltage (V). */
  limits: { power: number; voltage?: number };
  guide: { mission: string; kit: string; hints: string[] };
  /** Starting project: the fixed test environment only. */
  scaffold(): Project;
  /** Catalog reference design run by the challenge score guard. */
  reference(): Project;
  /** Operator actions the reference run needs (e.g. a manual reset); called before every step. */
  operateReference?(s: Simulation): void;
  /** Mechanical assignments are validated entirely by `validate`; the others also by the schematic rules. */
  spatial?: boolean;
  /** Mission-specific integrity; null when valid. */
  validate?(p: Project): string | null;
  /** Locked process vessels of a schematic assignment. */
  vessels?: { count: number; countError: string; matches(c: Component): boolean };
  /** Defaults applied to a component the player adds. */
  onAdd?(c: Component, p: Project): void;
  createState(): State;
  beforeStep?(s: Simulation, state: State): void;
  afterSolve?(s: Simulation, state: State, oldContacts: Record<string, boolean>, oldHeaterPower: number): void;
  update?(s: Simulation, state: State, dt: number): void;
  /** Scenario-controlled actuator value (e.g. a changing shaft load); `configured` otherwise. */
  actuatorValue?(s: Simulation, id: string, configured: number): number;
  evaluate(p: Project, s: Simulation, state: State): ChallengeResult;
  /** Prefix of the challenge-strip progress label. */
  progressLabel?(state: State): string;
  /** Live detail line in the challenge dialog. */
  liveStatus?(state: State): StatusPart[];
}

export const starsFor = (complete: boolean, score: number) => (complete ? (score >= 90 ? 3 : score >= 80 ? 2 : 1) : 0);
