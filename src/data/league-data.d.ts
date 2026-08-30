export type Slot = string;
export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "D/ST";

export interface Player {
  n: string;
  p: Position;
  t: string;
  arch: string;
  adp: number;
  e: number;
  f: number;
  s: number;
  rost: number;
  q: boolean;
  marketStat: string;
  ins: string;
  espnAdp: number;
  fpRank: number;
  bye: number;
  posRank: string;
}

export interface RosterEntry {
  n: string;
  pt: string;
  proj?: string;
  note?: string;
  slot?: string;
  w?: string;
}

export const TEAMS: Slot[];
export const TEAM_NAMES: Record<Slot, string>;
export const NFL: Record<string, string>;
export const POOL: Player[];

export const AGES: Record<string, { age: number; exp: number }>;
export const ROLES: Record<string, { role: string; ahead: string | null; depth: number; team: string }>;
export const FIN25: Record<string, { pos: string; posRank: number; overall: number; ttl: number; avg: number; gp: number }>;
export const DEFENSE: Record<string, Record<string, string | number>>;
export const KICK: Record<string, Record<string, string | number>>;
export const PASS: Record<string, Record<string, string | number>>;
export const RUSH: Record<string, Record<string, string | number>>;
export const RECV: Record<string, Record<string, string | number>>;
export const DETAIL: Record<string, { age: number; bye: number; sos: string; stat: string }>;

/** Grouped by display row: [[QB], [RB, RB], [WR, WR, TE], [FLEX, FLEX], [D/ST, K]]. */
export const STARTERS: RosterEntry[][];
export const BENCH: RosterEntry[];
export const IR: RosterEntry[];
export const SEEDED_TEAM: Slot;
export const MY_TEAM: Slot;

export const LOGOS: Record<string, string>;
export const HEADSHOTS: Record<string, string>;

export interface Manager {
  slot: Slot;
  name?: string;
  franchise?: string;
}

/** Reads localStorage — browser only. Returns null on the server. */
export function manager(): Manager | null;
export function myTeam(): Slot;
export function teamName(slot: Slot): string;
export function managerName(slot: Slot): string | null;
export function logo(team: string): string;
export function headshot(name: string): string;

// These take the player object, not the name.
export function statLine(p: Pick<Player, "n" | "p" | "t">): string;
export function roleOf(p: Pick<Player, "n" | "p" | "t">): string;
export function ageOf(p: Pick<Player, "n">): number | null;
export function expOf(p: Pick<Player, "n">): number | null;
export function byeOf(p: { n: string; bye?: number | null }): number | null;

export function find(name: string): Player | null;
