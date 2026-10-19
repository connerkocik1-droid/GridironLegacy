"use client";

import { useSyncExternalStore } from "react";
import type { Game } from "./espn";

/**
 * This week's NFL slate, keyed by club, shared by every screen that labels a
 * player with his game — "Q3 4:12", "FINAL", "SUN 1:00 PM" — and by the
 * GameCast list. One poll for the whole app, on the scoreboard route's own
 * thirty-second cache.
 */

let games: Game[] = [];
let week: number | null = null;
let started = false;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await fetch("/api/scoreboard?league=1", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    games = body.games ?? [];
    week = body.week ?? null;
    snapshot = { games, week };
    for (const l of listeners) l();
  } catch {
    // Labels fall back to the team alone.
  }
}

let snapshot: { games: Game[]; week: number | null } = { games, week };

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!started) {
    started = true;
    void load();
    setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, 30_000);
  }
  return () => {
    listeners.delete(fn);
  };
}

const EMPTY = { games: [] as Game[], week: null };

export function useNflGames(): { games: Game[]; week: number | null } {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** The two spellings Washington goes by, and any other club that has two. */
const ALIAS: Record<string, string> = { WAS: "WSH", WSH: "WSH", JAC: "JAX", LA: "LAR" };
const norm = (t: string) => ALIAS[t.toUpperCase()] ?? t.toUpperCase();

/** A club's game this week, or null for a bye. */
export function gameFor(list: Game[], team: string | null | undefined): Game | null {
  if (!team) return null;
  const t = norm(team);
  return list.find((g) => (g.home && norm(g.home.abbrev) === t) || (g.away && norm(g.away.abbrev) === t)) ?? null;
}

/** What the design writes under a player: "Q3 4:12", "FINAL", "SUN 4:25". */
export function gameLabel(g: Game | null): string {
  if (!g) return "BYE";
  if (g.state === "post") return "FINAL";
  if (g.state === "in") return shortStatus(g.statusDetail);
  const d = new Date(g.date);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase();
}

/** "3rd Quarter - 4:12" → "Q3 4:12"; "Halftime" → "HALF"; "End of 2nd" → "END Q2". */
export function shortStatus(detail: string | null | undefined): string {
  const d = String(detail ?? "").trim();
  if (!d) return "LIVE";
  const q = d.match(/(\d)(?:st|nd|rd|th)\s*(?:quarter|qtr)?\D*?(\d{1,2}:\d{2})/i);
  if (q) return `Q${q[1]} ${q[2]}`;
  if (/half/i.test(d)) return "HALF";
  const end = d.match(/end of (?:the )?(\d)/i);
  if (end) return `END Q${end[1]}`;
  if (/^ot|overtime/i.test(d)) return d.match(/\d{1,2}:\d{2}/) ? `OT ${d.match(/\d{1,2}:\d{2}/)![0]}` : "OT";
  return d.toUpperCase();
}
