"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRefreshable } from "@/lib/use-refresh";
import { useMe } from "@/lib/use-me";

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
 * A bell with a count, and a panel behind it. Polled on the same minute as
 * everything else on the page rather than on its own clock, so a phone open
 * on a Sunday is not making two sets of requests to say the same thing.
 *
 * Opening it marks everything read. That is deliberate: a per-notice read
 * mark is more bookkeeping than a twelve-person league needs, and a count
 * that will not go away is worse than no count.
 */
export default function Notices() {
  const me = useMe();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notices", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setNotices(body.notices ?? []);
      setUnread(body.unread ?? 0);
    } catch {
      // A bell that cannot be filled is a bell with nothing in it, which is
      // the same thing the page shows anyway.
    }
  }, []);

  // Answers a pull-to-refresh as well as its own timer.
  useRefreshable(load);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Clicking away closes it, which is what every menu on every site does and
  // what somebody will try before looking for a close button.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      try {
        await fetch("/api/notices", { method: "POST" });
      } catch {
        // The count is back next time the page polls if this did not land.
      }
    }
  }

  return (
    <div ref={box} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        onClick={() => void toggle()}
        aria-label={unread ? `Notices, ${unread} unread` : "Notices"}
        aria-expanded={open}
        // Round, and told so. A phone grows every button to a thumb-sized
        // target, and growing a circle in one direction only makes an egg —
        // which is what this was on every phone in the league. gl-round grows
        // it in both.
        className="gl-round"
        style={{
          position: "relative",
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          border: `1px solid ${unread ? "rgb(var(--accent-bright-rgb) / .55)" : "rgb(var(--accent-rgb) / .28)"}`,
          borderRadius: "50%",
          background: unread ? "rgb(var(--accent-rgb) / .2)" : "transparent",
          color: unread ? "var(--accent-text)" : "var(--text-muted)",
          font: "inherit",
          fontSize: 13,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {/* A drawn bell rather than the "◔" character it used to be. That
            glyph is a quarter-filled circle — it is not a bell, it renders at
            a different size in every font, and inside a forty-pixel target it
            read as a speck. This is the same construction as the tab bar's
            icons: one stroke weight, no fill, sized to the button. */}
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8.4a6 6 0 0 0-12 0c0 6.2-2.4 7.8-2.4 7.8h16.8S18 14.6 18 8.4" />
          <path d="M13.6 19.4a1.9 1.9 0 0 1-3.2 0" />
        </svg>
        {unread ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 15,
              height: 15,
              padding: "0 3px",
              borderRadius: 8,
              background: "var(--accent-link)",
              color: "var(--bg)",
              fontSize: 9.5,
              lineHeight: "15px",
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 0,
            width: "min(320px, calc(100vw - 32px))",
            maxHeight: 380,
            overflowY: "auto",
            border: "1px solid rgb(var(--accent-rgb) / .3)",
            borderRadius: "var(--radius-md)",
            background: "rgb(var(--bg-rgb) / .98)",
            backdropFilter: "blur(10px)",
            zIndex: 40,
            boxShadow: "0 12px 36px rgb(var(--shadow-rgb) / .45)",
            // The nav bar sets uppercase, wide tracking and nowrap for its
            // tabs, and this panel hangs inside it. Without resetting all
            // three, a notice is SHOUTED IN A SINGLE CLIPPED LINE.
            textTransform: "none",
            letterSpacing: "normal",
            whiteSpace: "normal",
            fontSize: 12.5,
            color: "var(--text)",
          }}
        >
          {/* Offered here rather than on the home page, because this is the one
              moment a manager is demonstrably reading their notices — and the
              offer is to get these same ones by email. Shown only while there
              is no address on the franchise, so it disappears the moment it is
              acted on and never nags anybody who already said yes. */}
          {me.status === "signed-in" && !me.manager?.email ? (
            <Link
              href="/my-team/edit"
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "11px 14px",
                borderBottom: "1px solid rgb(var(--accent-rgb) / .18)",
                fontSize: 11.5,
                color: "var(--accent-link)",
                textDecoration: "none",
                lineHeight: 1.5,
              }}
            >
              Get these by email too →
              <span style={{ display: "block", color: "var(--text-dim)", marginTop: 2 }}>
                So you hear about your pick when the site is closed.
              </span>
            </Link>
          ) : null}

          {notices.length === 0 ? (
            <div style={{ padding: "14px 14px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
              Nothing yet. This is where the league tells you it is your pick, that somebody has
              offered you a trade, or how your waiver claims went.
            </div>
          ) : (
            notices.map((n) => {
              const row = (
                <>
                  <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>{n.body}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-dim)",
                      marginTop: 3,
                      letterSpacing: ".14em",
                    }}
                  >
                    {n.kind.toUpperCase()} · {when(n.created_at)}
                  </div>
                </>
              );

              return (
                <div
                  key={n.id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid rgb(var(--accent-rgb) / .12)",
                    background: n.read_at ? "transparent" : "rgb(var(--accent-rgb) / .08)",
                  }}
                >
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => setOpen(false)}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}
                    >
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
      ) : null}
    </div>
  );
}
