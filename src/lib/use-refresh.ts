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

/** Registers a board's loader for as long as it is mounted. */
export function useRefreshable(load: Loader) {
  useEffect(() => {
    loaders.add(load);
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
