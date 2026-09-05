"use client";

import { useEffect } from "react";

/**
 * "Fetch it again", said in one place and heard by every board on the screen.
 *
 * Each board owns its own `load`, its own poll interval and its own idea of
 * how stale it is willing to be. That is right — the draft room and the rules
 * page should not be asking the server at the same rate — but it left no way
 * for anything outside a board to say "now", which is exactly what a
 * pull-to-refresh is.
 *
 * So the boards register their loader here and go on polling as before. The
 * gesture broadcasts; whoever is mounted answers. A page with three boards on
 * it refreshes all three in parallel, which is what somebody who pulled the
 * page down meant.
 *
 * Deliberately not a context. A provider would have to wrap the tree and every
 * board would have to be inside it, and the one thing doing the broadcasting
 * lives in the layout, above all of them.
 */

type Loader = () => void | Promise<unknown>;

const loaders = new Set<Loader>();

let watching = false;
let lastWoken = 0;

/**
 * Coming back to the app is a reason to ask again.
 *
 * A phone in a pocket is a page that has stopped: iOS freezes a backgrounded
 * home-screen app outright, and every board's own timer stops with it. Come
 * back five minutes later and the first thing on the screen is five-minute-old
 * data, until whichever interval happens to fire first.
 *
 * That is a nuisance on the standings and a real problem in the draft room,
 * where the room polls every five seconds precisely because five seconds is
 * as stale as whose-turn-is-it is allowed to get — and where a manager
 * unlocking their phone because they think they are on the clock is the exact
 * moment the screen must be right.
 *
 * Installed once, on the first board to register, and throttled: a phone can
 * fire visibilitychange several times as it settles, and three of those in a
 * second should be one round of requests and not three.
 */
function watchForeground() {
  if (watching || typeof document === "undefined") return;
  watching = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastWoken < 3000) return;
    lastWoken = Date.now();
    void refreshAll(0);
  });
}

/** Registers a board's loader for as long as it is mounted. */
export function useRefreshable(load: Loader) {
  useEffect(() => {
    loaders.add(load);
    watchForeground();
    return () => {
      loaders.delete(load);
    };
  }, [load]);
}

/**
 * Runs every mounted board's loader and resolves when the slowest is done.
 *
 * allSettled rather than all: one board whose endpoint is down must not stop
 * the spinner for the two beside it that came back fine. And a floor, because
 * a refresh that resolves in 40ms reads as nothing having happened — the
 * spinner has to be seen to spin or the gesture feels ignored.
 */
export async function refreshAll(minimumMs = 420): Promise<void> {
  const started = Date.now();
  await Promise.allSettled([...loaders].map((load) => load()));
  const left = minimumMs - (Date.now() - started);
  if (left > 0) await new Promise((done) => setTimeout(done, left));
}

/** Whether anything is listening, so the gesture can stay out of the way. */
export function hasRefreshable(): boolean {
  return loaders.size > 0;
}
