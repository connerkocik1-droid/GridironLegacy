"use client";

import { useSyncExternalStore } from "react";

/**
 * How much has been said since you last looked.
 *
 * A twelve-manager league lives or dies on the conversation, and the app gave
 * it no pull at all: chat was a card among eight on a page one press in, with
 * nothing anywhere to say that anybody had said anything. So it happened in a
 * group text instead, which is where leagues go to stop using the site.
 *
 * The count is per-browser rather than per-manager, because "read" is a thing
 * about a person looking at a screen and not a fact about the league — and
 * because a read-receipts table is a schema change, a migration and a write on
 * every page view to answer a question a single localStorage key answers.
 *
 * A browser that has never opened the chat starts at nought rather than at the
 * whole history: arriving to "47 unread" from a conversation you were never
 * part of is a badge you dismiss rather than a badge you follow.
 */

const KEY = "pylon:chat-seen";

/** Often enough to notice, rarely enough that twelve phones are not a load. */
const POLL_MS = 45_000;

let unread = 0;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function seen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // A browser with storage turned off gets no badge and no error. It is a
    // count of messages, not something the page needs to work.
    return null;
  }
}

function remember(at: string) {
  try {
    localStorage.setItem(KEY, at);
  } catch {
    // As above.
  }
}

/**
 * Everything up to `at` has been read. Called by the chat screen with the time
 * of the last message it drew.
 */
export function markChatRead(at: string) {
  remember(at);
  if (unread !== 0) {
    unread = 0;
    emit();
  }
}

async function poll() {
  // A phone left on a page overnight should not spend the night asking.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  const since = seen();

  // First run in this browser. Today's silence is the baseline; the history is
  // not unread, it is simply history.
  if (!since) {
    remember(new Date().toISOString());
    return;
  }

  try {
    const res = await fetch(`/api/chat?since=${encodeURIComponent(since)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = await res.json();

    // Your own messages are not news to you, and posting one should not leave
    // a badge on the tab you posted it from.
    const next = (body.messages ?? []).filter(
      (m: { mine?: boolean }) => !m.mine,
    ).length;

    if (next !== unread) {
      unread = next;
      emit();
    }
  } catch {
    // Keep whatever the last answer was rather than clearing the badge on a
    // dropped request: a count that flickers to nought and back is worse than
    // a count that is a minute stale.
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      started = false;
    }
  };
}

/** Subscribed to nothing, for a visitor who has no league to have unread. */
function idle() {
  return () => {};
}

/**
 * Pass `false` for anybody not signed in. The bar this feeds renders for them
 * for a moment before it decides not to, and without this that moment starts a
 * poll that can only ever be answered with a 401 — every forty-five seconds,
 * on the sign-in screen.
 */
export function useChatUnread(active = true): number {
  return useSyncExternalStore(
    active ? subscribe : idle,
    () => (active ? unread : 0),
    () => 0,
  );
}
