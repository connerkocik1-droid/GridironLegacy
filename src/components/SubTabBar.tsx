"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppTab } from "@/lib/app-tabs";
import { subTabFor } from "@/lib/app-tabs";
import { blip } from "@/lib/retro";

/**
 * The strip of destinations under a tab — Roster, Matchup, Around League,
 * Standings, GameCast for The League, and so on. One component rather than
 * three, so the sub-tabs for a tab never drift from `APP_TABS`.
 */
export default function SubTabBar({ tab }: { tab: AppTab }) {
  const pathname = usePathname() ?? "";
  const active = subTabFor(tab, pathname);

  return (
    <div
      className="gl-subtabs"
      role="tablist"
      aria-label={tab.label}
      style={{
        display: "flex",
        gap: 13,
        overflowX: "auto",
        scrollbarWidth: "none",
        padding: "9px 4px 0",
        backgroundImage:
          "linear-gradient(90deg,transparent,color-mix(in oklch, var(--text) 9%, transparent) 40px,color-mix(in oklch, var(--text) 9%, transparent) calc(100% - 40px),transparent)",
        backgroundSize: "100% 1px",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "bottom",
      }}
    >
      {tab.subtabs.map((sub) => {
        const on = active?.href === sub.href;
        return (
          <Link
            key={sub.href}
            href={sub.href}
            role="tab"
            aria-selected={on}
            onClick={on ? undefined : blip}
            style={{
              flex: "0 0 auto",
              fontSize: 12,
              padding: "0 0 10px",
              whiteSpace: "nowrap",
              textDecoration: "none",
              transition: "color .15s ease",
              color: on ? "var(--text)" : "var(--ap-n500)",
              boxShadow: on ? "inset 0 -2px 0 var(--ap-accent)" : "none",
            }}
          >
            {sub.label}
          </Link>
        );
      })}
    </div>
  );
}
