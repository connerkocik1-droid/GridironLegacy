"use client";

import { useEffect, useRef, useState } from "react";
import { setTheme, useTheme, type Choice } from "@/lib/use-theme";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMe } from "@/lib/use-me";
import TeamCrest from "./TeamCrest";
import TeamSettings from "./TeamSettings";

/**
 * The manager's own corner of the app: their crest, their team's name, their
 * PIN, and the way out.
 *
 * The editing itself lives in TeamSettings, which the Edit Team page renders
 * too — the same three forms saving the same three ways, wherever they are
 * opened from. What is only here is the dropdown around them and the sign-out,
 * which has to be reachable from every page and belongs to no page.
 */

const rowButton: React.CSSProperties = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 14px",
  minHeight: 34,
  border: "none",
  borderTop: "1px solid rgb(var(--accent-rgb) / .14)",
  background: "transparent",
  color: "var(--text-2)",
  font: "inherit",
  fontSize: 12.5,
  textAlign: "left",
  cursor: "pointer",
  textDecoration: "none",
};

export default function ProfileMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  // Where the panel sits, measured from the button when it opens. The nav is
  // a horizontal scroller, which clips anything positioned inside it, so the
  // panel is rendered against the body and pointed back at the button.
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const [busy, setBusy] = useState(false);

  const wrap = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  // Escape closes, and so does a click anywhere else — a panel that traps you
  // until you find its own close button is a panel people stop opening.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is not inside the button's wrapper any more, so both count
      // as "inside" for the purpose of not closing.
      if (wrap.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    // The measurement is only true for the layout it was taken in.
    const onResize = () => setOpen(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Nothing to be the profile of until somebody is signed in.
  if (me.status !== "signed-in" || !me.manager) return null;
  const manager = me.manager;

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      // Straight to the sign-in page, which is the site root. A hard
      // navigation rather than a router push, and the lint rule that prefers
      // one is wrong here: a soft navigation keeps every client cache on the
      // page — the session store behind this menu, the draft board, the
      // rosters — all of it fetched as the manager who just left.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  return (
    <div ref={wrap} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
          setOpen((was) => !was);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${manager.franchise} — your profile`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 2,
          border: "none",
          background: "transparent",
          font: "inherit",
          cursor: "pointer",
          borderRadius: "50%",
          outline: open ? "1px solid rgb(var(--accent-bright-rgb) / .6)" : undefined,
          outlineOffset: 2,
        }}
      >
        <TeamCrest franchise={manager.franchise} logo={manager.logo} size={30} />
      </button>

      {open ? (
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Your profile"
            style={{
              position: "fixed",
              top: anchor.top,
              right: anchor.right,
              width: 310,
              maxHeight: "min(78vh, 560px)",
              overflowY: "auto",
              zIndex: 60,
              border: "1px solid rgb(var(--accent-rgb) / .3)",
              borderRadius: "var(--radius-lg)",
              background: "var(--board-solid)",
              boxShadow: "0 18px 44px rgb(var(--scrim-rgb) / .6)",
              textAlign: "left",
              animation: "gl-fade 140ms ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 14px 13px" }}>
              <TeamCrest franchise={manager.franchise} logo={manager.logo} size={40} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 15,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {manager.franchise}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{manager.name}</div>
              </div>
            </div>

            {/* The way to everything else about this franchise. Put above the
                forms because most of what a manager wants from their own team
                is not a settings change. */}
            <Link href="/my-team" onClick={() => setOpen(false)} style={rowButton}>
              My Team
              <span aria-hidden style={{ color: "var(--text-dim)" }}>→</span>
            </Link>

            <TeamSettings manager={manager} />

            <ThemeChoice />

            {/* ------------------------------------------------- sign out --- */}
            <button
              onClick={() => void signOut()}
              disabled={busy}
              style={{ ...rowButton, color: "var(--bad)", cursor: busy ? "default" : "pointer" }}
            >
              Sign out
            </button>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

/**
 * Light, dark, or whatever the phone says.
 *
 * Here rather than in a settings page because it is a preference about this
 * screen, not about this franchise — and because the profile menu is the one
 * place in the app that is already about you rather than about the league.
 *
 * System is the default and comes first: a phone that goes dark at sunset
 * should take the app with it, and most people never touch this at all. The
 * other two exist for the manager who wants dark at noon.
 */
function ThemeChoice() {
  const choice = useTheme();

  const options: [Choice, string][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];

  return (
    <div
      style={{
        padding: "12px 14px 13px",
        borderTop: "1px solid rgb(var(--accent-rgb) / .16)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".18em",
          color: "var(--text-dim)",
          marginBottom: 8,
        }}
      >
        APPEARANCE
      </div>
      <div role="group" aria-label="Appearance" style={{ display: "flex", gap: 4 }}>
        {options.map(([value, label]) => {
          const on = choice === value;
          return (
            <button
              key={value}
              onClick={() => setTheme(value)}
              aria-pressed={on}
              style={{
                flex: 1,
                minHeight: 34,
                padding: "6px 4px",
                fontSize: 11,
                border: `1px solid ${on ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
                background: on ? "rgb(var(--accent-rgb) / .26)" : "transparent",
                color: on ? "var(--text)" : "var(--text-muted)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
