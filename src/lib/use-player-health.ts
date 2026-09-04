"use client";

import { useSyncExternalStore } from "react";
import { normalizeName } from "./player-names";
import { toHealth, type Health } from "./health";
import { find } from "@/data/league-data";

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
 * One player's fitness.
 *
 * The injury report first, because it is today's. The draft pool's own
 * questionable flag second, so a league whose ESPN feed is unreachable still
 * shows the designation it was drafted with rather than nothing at all.
 */
export function healthOf(report: Report, name: string): HealthEntry | null {
  const reported = report[normalizeName(name)];
  if (reported) return reported;

  const pooled = find(name);
  if (pooled?.q) {
    return { status: toHealth("questionable"), detail: "Questionable", note: "" };
  }
  return null;
}
