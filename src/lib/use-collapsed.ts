"use client";

import { useSyncExternalStore } from "react";

/**
 * Which sections of a page a reader has folded away.
 *
 * Per browser, like the pick animation: how much of the home page somebody
 * wants on screen is a fact about their screen, not about the league. Nothing
 * here is sent anywhere, and one manager collapsing the mini-games does not
 * collapse them for anybody else.
 *
 * Everything is open until told otherwise, and the server snapshot says so
 * too — so the first paint matches and a section does not flash open before
 * folding shut.
 */
const KEY = "gl.collapsed";

let value: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function read(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};

    // Only the shape this writes. A hand-edited or half-written value should
    // leave the page open rather than throwing on every render.
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function snapshot(): Record<string, boolean> {
  if (value === null) value = read();
  return value;
}

const OPEN: Record<string, boolean> = {};

/** Everything open, which is what the server renders. */
function serverSnapshot(): Record<string, boolean> {
  return OPEN;
}

export function setCollapsed(id: string, collapsed: boolean) {
  const next = { ...snapshot() };
  if (collapsed) next[id] = true;
  else delete next[id];

  value = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The fold still holds for this page; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useCollapsed(): Record<string, boolean> {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
