"use client";

import { useSyncExternalStore } from "react";
import { normalizeName } from "./player-names";
import { type Health } from "./health";

/**
 * Every player's fitness, asked for once per page rather than once per row.
 *
 * The same shape as use-logos: a small store behind useSyncExternalStore, so a
 * lineup with sixteen names on it makes one request. Nothing built on this may
 * treat "not loaded yet" as "injured" — until the report arrives everybody
 * reads as fit, which is what the app said before any of this existed.
 */

export interface HealthEntry {
  status: Health;
  /** ESPN's own word, which is more precise than our five. */
  detail: string;
  note: string;
}

type Report = Record<string, HealthEntry>;

let state: Report = {};
let started = false;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await fetch("/api/player-status");
    if (!res.ok) return;
    const body = await res.json();
    state = body.statuses ?? {};
    for (const listener of listeners) listener();
  } catch {
    // Fitness is an annotation. Failing to fetch it must never be visible as
    // anything other than the absence of a badge.
  }
}

export function refreshHealth() {
  return load();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    void load();
  }
  return () => listeners.delete(onChange);
}

const EMPTY: Report = {};

export function useHealthReport(): Report {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/**
 * One player's fitness, from today's injury report and nothing else.
 *
 * This used to fall back to the draft pool's own questionable flag whenever
 * the report said nothing, so that a league with an unreachable ESPN feed
 * "still shows the designation it was drafted with rather than nothing at
 * all". That was the wrong trade and it showed: an injury designation is a
 * statement about one week, and a column in a static table cannot make it.
 * The flag was a snapshot taken once, months before the season, and the
 * report says nothing about a healthy player — which is the normal case — so
 * the fallback fired constantly and never expired.
 *
 * A hundred and thirty-eight players out of nine hundred and forty-four wore
 * a permanent Q, Christian McCaffrey and Puka Nacua among them. A badge that
 * is on one name in seven is not information; it is furniture, and it hides
 * the two names that actually matter this Sunday.
 *
 * So: no report, no badge. If the feed is unreachable the app says nothing
 * about anybody's fitness, which is exactly what it knows.
 */
export function healthOf(report: Report, name: string): HealthEntry | null {
  return report[normalizeName(name)] ?? null;
}
