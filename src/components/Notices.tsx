"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRefreshable } from "@/lib/use-refresh";
import { useMe } from "@/lib/use-me";
import { hairline, tint } from "./RowList";

interface Notice {
  id: string;
  kind: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

/** How long ago, at the resolution somebody actually cares about. */
function when(iso: string) {
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

/**
 * What the league has told you.
 *
 * The redesign has no bell: notices live in the avatar menu, and the avatar
 * carries a dot while any are unread. So this is a small shared store — the
 * dot and the menu row read the same list — polled on the same minute as
 * everything else on the page.
 *
 * Opening the list marks everything read. That is deliberate: a per-notice
 * read mark is more bookkeeping than a twelve-person league needs, and a
 * count that will not go away is worse than no count.
 */

let state: { notices: Notice[]; unread: number } = { notices: [], unread: 0 };
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function load() {
  try {
    const res = await fetch("/api/notices", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    state = { notices: body.notices ?? [], unread: body.unread ?? 0 };
    emit();
  } catch {
    // Nothing to tell is what the menu shows anyway.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!started) {
    started = true;
    void load();
    setInterval(() => void load(), 60_000);
  }
  return () => {
    listeners.delete(fn);
  };
}

const EMPTY = { notices: [] as Notice[], unread: 0 };

export function useNotices() {
  // Answers a pull-to-refresh as well as its own timer.
  useRefreshable(load);
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** Marks everything read, here and on the server. */
async function markRead() {
  if (!state.unread) return;
  state = { ...state, unread: 0 };
  emit();
  try {
    await fetch("/api/notices", { method: "POST" });
  } catch {
    // The count comes back on the next poll, which is the honest outcome.
  }
}

/** The list, as the avatar menu's Notices row opens it. */
export function NoticeList({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const { notices } = useNotices();

  // Opening it is reading it.
  useEffect(() => {
    void markRead();
  }, []);

  return (
    <div style={{ fontSize: 12.5, color: "var(--text)" }}>
      {/* Offered here, because this is the one moment a manager is
          demonstrably reading their notices — and the offer is to get these
          same ones by email. Gone the moment there is an address. */}
      {me.status === "signed-in" && !me.manager?.email ? (
        <Link
          href="/my-team/edit"
          onClick={onNavigate}
          style={{ display: "block", padding: "4px 0 10px", fontSize: 11.5, color: "var(--ap-a300)", textDecoration: "none", lineHeight: 1.5 }}
        >
          Get these by email too →
          <span style={{ display: "block", color: "var(--ap-n500)", marginTop: 2 }}>
            So you hear about your pick when the site is closed.
          </span>
        </Link>
      ) : null}

      {notices.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ap-n400)", lineHeight: 1.55 }}>
          Nothing yet. This is where the league tells you it is your pick, that somebody has offered
          you a trade, or how your waiver claims went.
        </div>
      ) : (
        notices.map((n, i) => {
          const row = (
            <>
              <div style={{ lineHeight: 1.5 }}>{n.body}</div>
              <div style={{ fontSize: 9.5, color: "var(--ap-n500)", marginTop: 3, letterSpacing: ".14em" }}>
                {n.kind.toUpperCase()} · {when(n.created_at)}
              </div>
            </>
          );
          return (
            <div
              key={n.id}
              style={{
                ...(i ? hairline : {}),
                padding: "9px 6px",
                margin: "0 -6px",
                backgroundColor: n.read_at ? undefined : tint(8),
              }}
            >
              {n.href ? (
                <Link href={n.href} onClick={onNavigate} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                  {row}
                </Link>
              ) : (
                row
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
