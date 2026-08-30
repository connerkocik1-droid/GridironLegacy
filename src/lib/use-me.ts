"use client";

import { useSyncExternalStore } from "react";

export interface Me {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  is_commissioner: boolean;
  ready: boolean;
  /** Their team photo as a data URI, or null for the lettered fallback. */
  logo: string | null;
}

export type MeState = {
  status: "checking" | "signed-in" | "signed-out" | "no-league";
  manager: Me | null;
};

/**
 * Who is signed in, asked once per page rather than once per component.
 *
 * The nav gate, the profile button and the office pages all want the same
 * answer, and before this each of them fetched it. Holding it in a small store
 * means one request, and means a rename in the profile panel can be pushed
 * back out to the button in the corner without a reload.
 *
 * A failed request leaves the state as `checking` on purpose. Everything built
 * on this hides on anything but a clear answer, so being unsure must not look
 * like being signed out — still less like being the commissioner.
 */
const CHECKING: MeState = { status: "checking", manager: null };

let state: MeState = CHECKING;
let started = false;
const listeners = new Set<() => void>();

function publish(next: MeState) {
  state = next;
  for (const listener of listeners) listener();
}

async function load() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return;

    const data = await res.json();
    if (data.configured === false) return publish({ status: "no-league", manager: null });

    publish(
      data.manager
        ? { status: "signed-in", manager: data.manager as Me }
        : { status: "signed-out", manager: null },
    );
  } catch {
    // Offline, or the request was abandoned by a navigation. Whatever was
    // known before stands.
  }
}

/** Re-reads the session — call it after changing something the header shows. */
export function refreshMe() {
  return load();
}

/** Updates the local copy at once, so a save is not followed by a flicker. */
export function patchMe(changes: Partial<Me>) {
  if (state.manager) publish({ ...state, manager: { ...state.manager, ...changes } });
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

export function useMe(): MeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CHECKING,
  );
}

export type Office = "checking" | "commissioner" | "manager" | "no-league";

/** The same answer, narrowed to the one question the nav gates ask. */
export function useOffice(): Office {
  const me = useMe();
  if (me.status === "checking") return "checking";
  if (me.status === "no-league") return "no-league";
  return me.manager?.is_commissioner ? "commissioner" : "manager";
}
