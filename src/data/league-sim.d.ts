import type { Player } from "./league-data";

export interface Settings {
  starters?: Record<string, number>;
  bench?: number;
  ir?: number;
  rounds?: number;
  [key: string]: unknown;
}

export interface RosterEntry {
  p: Player;
  ov?: number;
  r?: number;
}

export const LINEUP_SLOTS: string[];
export const FLEX_TAKES: string[];
export const ROUNDS: number;

export function useSettings(settings: Settings): void;
export function slotsOf(settings?: Settings): string[];
export function roundsOf(settings?: Settings): number;
export function targetsOf(settings?: Settings): Record<string, number>;
export function proj(m: unknown, p: Player): number;
export function buildLeague(m: unknown): RosterEntry[][];
export function startersOf(
  m: unknown,
  roster: RosterEntry[],
  settings?: Settings,
): { slot: string; x: RosterEntry | null }[];
export function lineupPoints(m: unknown, roster: RosterEntry[], settings?: Settings): number;
export function dynastyValue(m: unknown, p: Player): number;
export function pickAssets(team: string, year: number): { id: string; round: number; year: number }[];
export function pickValue(pick: { round: number; year: number }, year: number): number;
