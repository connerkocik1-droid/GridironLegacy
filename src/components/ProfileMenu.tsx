"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { setTheme, useTheme, type Choice } from "@/lib/use-theme";
import { setRetro, useRetro } from "@/lib/retro";
import { useMe } from "@/lib/use-me";
import TeamCrest from "./TeamCrest";
import TeamSettings from "./TeamSettings";
import { NoticeList, useNotices } from "./Notices";
import { MenuLabel, menuBody, menuButton, menuRowStyle } from "./menu-style";
import { ink, tint, wideBtnStyle } from "./RowList";

/**
 * The manager's own corner of the app, behind their crest in the header.
 *
 * The redesign's avatar menu (prototype/Pylon App.dc.html): one glass panel
 * of rows that expand in place — sixteen-bit mode, notices, the team's name,
 * email, alerts, photo and PIN, the league rules, the commissioner's office
 * for the commissioner, appearance, and the way out. The editing itself lives
 * in TeamSettings, which the Edit Team page renders too, so the same forms
 * save the same ways wherever they are opened from.
 */
export default function ProfileMenu() {
  const me = useMe();
  const { unread } = useNotices();
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<string | null>(null);
  // Where the panel sits, measured from the header card when it opens. It is
  // rendered against the body, so nothing in the header can clip it.
  const [anchor, setAnchor] = useState({ top: 0, right: 10, left: 10 });
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
      // A hard navigation rather than a router push: a soft one keeps every
      // client cache on the page, all of it fetched as the manager who left.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  const toggleRow = (id: string) => setRow((was) => (was === id ? null : id));
  const close = () => setOpen(false);

  return (
    <div ref={wrap} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        onClick={(e) => {
          const card = (e.currentTarget.closest(".gl-navcard") ?? e.currentTarget).getBoundingClientRect();
          const wide = window.innerWidth > 720;
          setAnchor({
            top: card.bottom + 8,
            right: Math.max(10, window.innerWidth - card.right),
            left: wide ? -1 : Math.max(10, card.left),
          });
          setRow(null);
          setOpen((was) => !was);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${manager.franchise} — your profile${unread ? `, ${unread} new notices` : ""}`}
        // A 32px square crest, as the redesign draws it, inside a 40px target.
        className="gl-press"
        style={{
          position: "relative",
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          padding: 0,
          border: "none",
          background: "transparent",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
            borderRadius: 4,
            border: `1px solid ${open ? "var(--ap-a100)" : ink(20)}`,
            boxShadow: open ? "0 0 12px var(--ap-accent)" : undefined,
          }}
        >
          <TeamCrest franchise={manager.franchise} logo={manager.logo} size={30} shape="box" />
        </span>
        {unread ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "var(--ap-a300)",
              border: "2px solid var(--bg)",
              boxShadow: "0 0 8px var(--ap-accent)",
            }}
          />
        ) : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={panel}
              data-panel="1"
              role="dialog"
              aria-label="Your profile"
              style={{
                position: "fixed",
                top: anchor.top,
                right: anchor.right,
                ...(anchor.left >= 0 ? { left: anchor.left } : { width: 360 }),
                maxHeight: "min(78vh, 640px)",
                overflowY: "auto",
                zIndex: 60,
                borderRadius: 6,
                background:
                  "linear-gradient(180deg,color-mix(in oklch, var(--bg) 90%, transparent),color-mix(in oklch, var(--bg) 97%, transparent))",
                backdropFilter: "blur(30px) saturate(170%)",
                WebkitBackdropFilter: "blur(30px) saturate(170%)",
                border: `1px solid ${ink(11)}`,
                boxShadow: `inset 0 1px 0 ${ink(12)}, 0 18px 44px rgb(var(--scrim-rgb) / .6)`,
                textAlign: "left",
                color: "var(--text)",
                textTransform: "none",
                letterSpacing: "normal",
                whiteSpace: "normal",
                animation: "ap-drop .22s ease both",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 500,
                      fontStyle: "italic",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {manager.franchise}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ap-n500)", marginTop: 3 }}>
                    {manager.name}
                    {manager.is_commissioner ? " · Commissioner" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  style={{
                    cursor: "pointer",
                    border: 0,
                    background: "transparent",
                    color: "var(--ap-n400)",
                    fontSize: 18,
                    lineHeight: 1,
                    width: 32,
                    height: 32,
                  }}
                >
                  ×
                </button>
              </div>

              <RetroSwitch first />

              <ExpandRow
                id="notices"
                open={row === "notices"}
                onToggle={toggleRow}
                hint={unread ? `${unread} new` : "All read"}
                label="Notices"
              >
                <NoticeList onNavigate={close} />
              </ExpandRow>

              <TeamSettings manager={manager} />

              <Link href="/rules" onClick={close} style={{ ...menuButton, ...menuRowStyle(false), textDecoration: "none" }}>
                <MenuLabel hint="Rulebook">League rules</MenuLabel>
              </Link>

              {manager.is_commissioner ? (
                <Link
                  href="/commissioner"
                  onClick={close}
                  style={{ ...menuButton, ...menuRowStyle(false), textDecoration: "none" }}
                >
                  <MenuLabel hint="Commissioner" tone="accent">
                    Commissioner settings
                  </MenuLabel>
                </Link>
              ) : null}

              <ExpandRow
                id="appearance"
                open={row === "appearance"}
                onToggle={toggleRow}
                hint={<ThemeHint />}
                label="Appearance"
              >
                <ThemeChoice />
              </ExpandRow>

              <ExpandRow id="out" open={row === "out"} onToggle={toggleRow} label="Sign out" tone="quiet">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={busy}
                  style={wideBtnStyle(!busy, true)}
                >
                  {busy ? "SIGNING OUT…" : "SIGN OUT OF PYLON"}
                </button>
              </ExpandRow>
              <div style={{ height: 6 }} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** A menu row that opens in place to show what is under it. */
function ExpandRow({
  id,
  label,
  hint,
  tone,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  tone?: "quiet";
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={menuRowStyle(open)}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} style={menuButton}>
        <MenuLabel hint={hint} open={open} tone={tone}>
          {label}
        </MenuLabel>
      </button>
      {open ? <div style={{ ...menuBody, animation: "ap-rise .2s ease both" }}>{children}</div> : null}
    </div>
  );
}

/**
 * Sixteen-bit mode, the first row of the menu.
 *
 * A switch rather than a fourth appearance: it is a skin over light or dark,
 * not a brightness, and it does not stick — every launch starts modern, which
 * the row says so nobody is surprised by it. See retro.ts.
 */
function RetroSwitch({ first }: { first?: boolean }) {
  const on = useRetro();
  return (
    <div style={menuRowStyle(false, first)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: on ? "var(--ap-a200)" : undefined }}>16-bit mode</div>
          <div style={{ fontSize: 10, color: "var(--ap-n500)", marginTop: 2, lineHeight: 1.4 }}>
            SNES-style skin. Same app, same data. Resets to modern on launch.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="16-bit mode"
          onClick={() => setRetro(!on)}
          // The track is the design's 40x22 switch; the button around it is a
          // full thumb-sized target.
          style={{
            cursor: "pointer",
            flex: "0 0 auto",
            width: 48,
            height: 40,
            padding: 0,
            border: 0,
            background: "transparent",
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            style={{
              width: 40,
              height: 22,
              boxSizing: "border-box",
              borderRadius: 11,
              padding: "0 3px",
              display: "flex",
              alignItems: "center",
              justifyContent: on ? "flex-end" : "flex-start",
              border: `1px solid ${on ? "var(--ap-a500)" : "var(--ap-n700)"}`,
              background: on ? tint(30) : "transparent",
            }}
          >
            <span
              style={{
                display: "block",
                width: 15,
                height: 15,
                borderRadius: "50%",
                background: on ? "var(--ap-a200)" : "var(--ap-n500)",
                boxShadow: on ? "0 0 8px var(--ap-accent)" : undefined,
              }}
            />
          </span>
        </button>
      </div>
    </div>
  );
}

const THEME_LABEL: Record<Choice, string> = { system: "System", light: "Light", dark: "Dark" };

function ThemeHint() {
  return <>{THEME_LABEL[useTheme()]}</>;
}

/**
 * Light, dark, or whatever the phone says.
 *
 * System is the default and comes first: a phone that goes dark at sunset
 * should take the app with it, and most people never touch this at all.
 * Sixteen-bit is not one of these; it is the switch at the top of the menu.
 */
function ThemeChoice() {
  const choice = useTheme();
  const options: Choice[] = ["system", "light", "dark"];

  return (
    <div role="group" aria-label="Appearance" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {options.map((value) => {
        const on = choice === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={on}
            style={{
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              padding: "5px 10px",
              minHeight: 32,
              borderRadius: 2,
              border: `1px solid ${on ? "var(--ap-a600)" : "var(--ap-n700)"}`,
              background: on ? tint(20) : "transparent",
              color: on ? "var(--text)" : "var(--ap-n400)",
            }}
          >
            {THEME_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}

