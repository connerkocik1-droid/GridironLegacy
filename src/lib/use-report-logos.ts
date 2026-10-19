"use client";

import { useSyncExternalStore } from "react";

/**
 * The Pylon Report's school and team crests, asked for once per page rather
 * than once per row — the same shape as use-logos.ts, for the same reason.
 *
 * CFB and the Pylon 50 share the 'cfb' scope: a school keyed once lights up
 * on both boards, which is why this is one store rather than two.
 */
export interface ReportLogos {
  cfb: Record<string, string>;
  nfl: Record<string, string>;
}

let state: ReportLogos = { cfb: {}, nfl: {} };
let started = false;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await fetch("/api/report-logos");
    if (!res.ok) return;
    const body = await res.json();
    state = { cfb: body.cfb ?? {}, nfl: body.nfl ?? {} };
    for (const listener of listeners) listener();
  } catch {
    // A crest is decoration. Failing to fetch one must never be visible as
    // anything other than the abbreviation tile that was there already.
  }
}

/** Re-reads the crests — call it after the commissioner sets or removes one. */
export function refreshReportLogos() {
  return load();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    void load();
  }
  return () => {
    listeners.delete(onChange);
  };
}

const EMPTY: ReportLogos = { cfb: {}, nfl: {} };

export function useReportLogos(): ReportLogos {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
