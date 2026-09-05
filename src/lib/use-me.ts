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
  /** Where the league emails them, or null if they have not given an address. */
  email?: string | null;
  /** Whether they want those emails at all. */
  email_notices?: boolean;
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
let attempts = 0;
const listeners = new Set<() => void>();

function publish(next: MeState) {
  attempts = 0;
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Asks, and keeps asking.
 *
 * This used to be one request with no retry: a failure returned quietly and
 * left the state at "checking" for the life of the page. Everything built on
 * this hides on anything but a clear answer, so a single dropped request took
 * the whole bottom navigation off the screen — permanently, because nothing
 * ever asked again.
 *
 * That is a rare thing in a browser tab and a common one in a home-screen
 * app, which is launched cold and resumed from the background, and where the
 * first request of a session regularly goes out before the network is there.
 * Which is exactly the shape of the bug: tabs missing in the PWA and nowhere
 * else.
 */
async function load(): Promise<void> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    // A 5xx from a cold serverless function is worth asking again about. So is
    // a 401, which here means the session cookie did not arrive rather than
    // that there is no session — /api/auth/me answers 200 with a null manager
    // for somebody who is genuinely signed out.
    if (!res.ok) throw new Error(String(res.status));

    const data = await res.json();
    if (data.configured === false) return publish({ status: "no-league", manager: null });

    publish(
      data.manager
        ? { status: "signed-in", manager: data.manager as Me }
        : { status: "signed-out", manager: null },
    );
  } catch {
    // Offline, or the request was abandoned by a navigation. Whatever was
    // known before stands — and it is asked again, four times, backing off to
    // about six seconds in total. Beyond that the listeners below take over:
    // coming back to the app, or the network coming back, is a better signal
    // to retry on than a timer.
    if (attempts < 4) {
      const wait = 400 * 2 ** attempts;
      attempts += 1;
      setTimeout(() => void load(), wait);
    }
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

    // A home-screen app is resumed far more often than it is launched, and a
    // session that expired while the phone was in a pocket should be noticed
    // on the way back in rather than on the next full page load — which in a
    // standalone app might be days away. This is also the retry that matters:
    // whatever failed at launch is asked again the moment the app is looked
    // at, or the moment the network returns.
    if (typeof window !== "undefined") {
      const again = () => {
        attempts = 0;
        void load();
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") again();
      });
      window.addEventListener("online", again);
      // iOS restores a standalone app from the back-forward cache, which fires
      // no visibilitychange of its own.
      window.addEventListener("pageshow", (e) => {
        if ((e as PageTransitionEvent).persisted) again();
      });
    }
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
