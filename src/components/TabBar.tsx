"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_TABS, appTabFor, type AppTab } from "@/lib/app-tabs";
import { useMe } from "@/lib/use-me";
import { useResolvedTheme } from "@/lib/use-theme";
import { playTabSound, primeTabSound } from "@/lib/retro-sfx";

/**
 * The three doors, where a thumb can reach them.
 *
 * Three rather than the old four-plus-office: the draft room and the
 * commissioner's own pages no longer hold a permanent slot down here — the
 * draft is a handful of days a year and the office is one manager's — so
 * this bar now only ever shows The League, General Manager and Rankings,
 * per the three-tab redesign. Reachable but unclaimed by any slot, `/draft`
 * and `/commissioner` simply light nothing when visited directly.
 *
 * A tab is active for everywhere its sub-tabs own, via `appTabFor` — the
 * same "longest claim wins" rule the four-tab bar used, now shared with
 * `Nav` and `SubTabBar` through `src/lib/app-tabs.ts` so the three never
 * disagree about where something lives.
 */
export default function TabBar({ signedIn }: { signedIn: boolean }) {
  const me = useMe();
  const pathname = usePathname() ?? "/";

  // The blip a tab makes in the sixteen-bit theme, and nowhere else.
  const retro = useResolvedTheme() === "16bit";
  useEffect(() => {
    if (retro) primeTabSound();
  }, [retro]);

  // Nothing for a signed-out visitor, or a league with no database yet —
  // every destination behind the bar would only ask them to sign in.
  const showing = me.status === "checking" ? signedIn : me.status === "signed-in";

  useEffect(() => {
    if (!showing) return;
    document.documentElement.dataset.tabbar = "1";
    return () => {
      delete document.documentElement.dataset.tabbar;
    };
  }, [showing]);

  if (!showing) return null;

  const active = appTabFor(pathname);

  return (
    <nav
      className="gl-tabbar"
      aria-label="Main"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        // `display` is set in globals.css, which knows the breakpoint.
        paddingBottom: "env(safe-area-inset-bottom)",
        borderTop: "1px solid rgb(var(--accent-rgb) / .14)",
        // Liquid glass, same treatment as the desktop Nav: a gradient over a
        // heavy blur rather than one flat translucent fill.
        background:
          "linear-gradient(180deg,rgb(var(--accent-rgb) / .1),rgb(var(--sunken-rgb) / .92))",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .12)",
      }}
    >
      {APP_TABS.map((tab) => (
        <TabLink key={tab.id} tab={tab} active={active?.id === tab.id} sound={retro} />
      ))}
    </nav>
  );
}

const ICON: Record<AppTab["id"], React.ReactNode> = {
  league: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.6V20h12V9.6" />
    </>
  ),
  gm: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M9 6V5a3 3 0 0 1 6 0v1" />
    </>
  ),
  rankings: (
    <>
      <path d="M4 20V11M10 20V4M16 20v8M20 20H4" />
    </>
  ),
};

function TabLink({ tab, active, sound }: { tab: AppTab; active: boolean; sound?: boolean }) {
  return (
    <Link
      href={tab.href}
      onClick={sound ? () => playTabSound() : undefined}
      aria-current={active ? "page" : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        minHeight: 52,
        padding: "7px 2px 8px",
        textDecoration: "none",
        position: "relative",
        color: active ? "var(--accent-text)" : "var(--text-quiet)",
        background: active
          ? "linear-gradient(180deg,rgb(var(--accent-rgb) / .16),transparent 72%)"
          : "transparent",
      }}
    >
      {active ? (
        <span
          aria-hidden
          className="gl-tab-lit"
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            width: 26,
            marginLeft: -13,
            height: 2,
            borderRadius: "0 0 2px 2px",
            background: "var(--accent-link)",
            boxShadow: "0 0 8px rgb(var(--accent-bright-rgb) / .55)",
          }}
        />
      ) : null}
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICON[tab.id]}
      </svg>
      <span
        style={{
          fontSize: 10,
          letterSpacing: ".04em",
          lineHeight: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {tab.label}
      </span>
    </Link>
  );
}
