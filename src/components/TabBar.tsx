"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_TABS, appTabFor, type AppTab } from "@/lib/app-tabs";
import { useMe } from "@/lib/use-me";
import { blip } from "@/lib/retro";

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
      data-panel="tab"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        // `display` is set in globals.css, which knows the breakpoint.
        paddingBottom: "env(safe-area-inset-bottom)",
        borderTop: "1px solid color-mix(in oklch, var(--text) 10%, transparent)",
        // Liquid glass, as the redesign draws it.
        background:
          "linear-gradient(180deg,color-mix(in oklch, var(--text) 6%, transparent),rgb(var(--bg-rgb) / .82))",
        backdropFilter: "blur(26px) saturate(170%)",
        WebkitBackdropFilter: "blur(26px) saturate(170%)",
        boxShadow: "inset 0 1px 0 color-mix(in oklch, var(--text) 10%, transparent)",
      }}
    >
      {APP_TABS.map((tab) => (
        <TabLink key={tab.id} tab={tab} active={active?.id === tab.id} />
      ))}
    </nav>
  );
}

// The redesign's three marks (Phosphor, filled): a trophy, a briefcase, a
// rising chart.
const ICON: Record<AppTab["id"], string> = {
  league:
    "M232 64h-24V48a8 8 0 0 0-8-8H56a8 8 0 0 0-8 8v16H24A16 16 0 0 0 8 80v16a40 40 0 0 0 40 40h3.65A80.13 80.13 0 0 0 120 191.61V216H96a8 8 0 0 0 0 16h64a8 8 0 0 0 0-16h-24v-24.42c31.94-3.23 58.44-25.64 68.08-55.58H208a40 40 0 0 0 40-40V80a16 16 0 0 0-16-16ZM48 120a24 24 0 0 1-24-24V80h24v32q0 4 .39 8Zm184-24a24 24 0 0 1-24 24h-.5a81.81 81.81 0 0 0 .5-8.9V80h24Z",
  gm: "M216 56h-40v-8a24 24 0 0 0-24-24h-48a24 24 0 0 0-24 24v8H40a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V72a16 16 0 0 0-16-16ZM96 48a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96Zm120 24v41.61A184 184 0 0 1 128 136a184.07 184.07 0 0 1-88-22.38V72Zm0 128H40v-68.36A200.19 200.19 0 0 0 128 152a200.25 200.25 0 0 0 88-20.37V200ZM104 112a8 8 0 0 1 8-8h32a8 8 0 0 1 0 16h-32a8 8 0 0 1-8-8Z",
  rankings:
    "M232 208a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V48a8 8 0 0 1 16 0v108.69l50.34-50.35a8 8 0 0 1 11.32 0L128 132.69 180.69 80H160a8 8 0 0 1 0-16h40a8 8 0 0 1 8 8v40a8 8 0 0 1-16 0V91.31l-58.34 58.35a8 8 0 0 1-11.32 0L96 123.31l-56 56V200h184a8 8 0 0 1 8 8Z",
};

function TabLink({ tab, active }: { tab: AppTab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      // "♪ BLIP" in sixteen-bit mode; a no-op otherwise. Visual only.
      onClick={active ? undefined : blip}
      aria-current={active ? "page" : undefined}
      className="gl-press"
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        minHeight: 52,
        padding: "7px 2px 4px",
        textDecoration: "none",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        className="gl-tab-lit"
        style={{
          position: "absolute",
          top: -1,
          left: "50%",
          transform: "translateX(-50%)",
          height: 2,
          width: active ? 56 : 0,
          transition: "width .25s ease",
          background: "linear-gradient(90deg,transparent,var(--ap-accent),transparent)",
          boxShadow: "0 0 10px var(--ap-accent)",
        }}
      />
      <svg
        viewBox="0 0 256 256"
        width="20"
        height="20"
        aria-hidden
        style={{
          fill: active ? "var(--ap-a200)" : "var(--ap-n500)",
          filter: active ? "drop-shadow(0 0 6px var(--ap-accent))" : undefined,
        }}
      >
        <path d={ICON[tab.id]} />
      </svg>
      <span
        style={{
          fontSize: 10,
          lineHeight: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
          ...(active
            ? { color: "var(--text)", fontStyle: "italic", fontWeight: 500 }
            : { color: "var(--ap-n500)" }),
        }}
      >
        {tab.label}
      </span>
    </Link>
  );
}
