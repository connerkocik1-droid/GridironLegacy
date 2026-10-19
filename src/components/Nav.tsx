"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CommissionerOnly from "./CommissionerOnly";
import ProfileMenu from "./ProfileMenu";
import HeaderMark from "./HeaderMark";
import { APP_TABS, appTabFor } from "@/lib/app-tabs";
import { blip } from "@/lib/retro";
import { panelMark } from "@/lib/liquid-glass";
import ScoreChip from "./ScoreChip";
import SubTabBar from "./SubTabBar";
import Ticker from "./Ticker";
import { ink } from "./RowList";

// Three doors, on a desktop too.
//
// The League, General Manager and Rankings — the same three the phone's
// bottom bar shows — replace the old five-wide bar (Home, My Team, The
// League, Moves, Draft) plus its separate office links. The draft room and
// the commissioner's own pages are a few days a year and one manager's,
// so they moved to the account corner instead of holding a permanent slot
// here.
//
// Active state now comes from the URL itself via `appTabFor`, the same
// "longest claim wins" rule the mobile bar and the sub-tab strip use — so
// this no longer needs every page to tell it which tab it's on.

const draftIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 9.5h16M9.5 9.5V20" />
  </svg>
);
const officeIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

// The redesign's header: a sticky strip over the page holding one liquid-glass
// card — the pylon and wordmark, your live score, the bell and your crest.
// From prototype/Pylon App.dc.html. The strip is tinted and blurred so rows
// scrolling under it read as under it rather than through it.
const strip: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  padding: "8px 10px 0",
  background: "linear-gradient(180deg,rgb(var(--bg-rgb) / .92),rgb(var(--bg-rgb) / .78))",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
};

const card: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 6,
  background: `linear-gradient(180deg,${ink(7)},${ink(2)})`,
  backdropFilter: "blur(24px) saturate(170%)",
  WebkitBackdropFilter: "blur(24px) saturate(170%)",
  border: `1px solid ${ink(9)}`,
  boxShadow: `inset 0 1px 0 ${ink(12)}, 0 6px 18px rgb(var(--shadow-rgb) / .35)`,
  ...panelMark,
};

const primaryLink = (active: boolean): React.CSSProperties => ({
  color: active ? "var(--text)" : "var(--ap-n500)",
  boxShadow: active ? "inset 0 -2px 0 var(--ap-accent)" : undefined,
  fontSize: 12,
  padding: "8px 8px",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
  textDecoration: "none",
});

const quietLink: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  color: "var(--text-dim)",
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  textDecoration: "none",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

/** @deprecated Active state is read from the URL now (see `appTabFor`);
 * kept so none of this app's ~25 page-level `<Nav current="..." />` calls
 * need to change. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Nav({ current }: { current?: string }) {
  const pathname = usePathname() ?? "/";
  const active = appTabFor(pathname);

  return (
    <div className="gl-nav" style={strip}>
     <div className="gl-navcard" style={card}>
      <HeaderMark />

      {/* Hidden on a phone, where the same three sit in a bar at the bottom
          within a thumb's reach. */}
      <div
        className="gl-navlinks"
        style={{ display: "flex", gap: 2, marginLeft: 10, flexWrap: "wrap", rowGap: 4 }}
      >
        {APP_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className="gl-navlink"
            aria-current={active?.id === tab.id ? "page" : undefined}
            onClick={active?.id === tab.id ? undefined : blip}
            style={primaryLink(active?.id === tab.id)}
          >
            {tab.label}
          </Link>
        ))}
        {/* The draft room and the commissioner's own pages, reachable but
            holding no slot of their own — a few days a year and one
            manager's, not a permanent destination. */}
        <Link href="/draft" className="gl-navlink" style={quietLink}>
          {draftIcon} Draft
        </Link>
        <CommissionerOnly>
          <Link href="/commissioner" className="gl-navlink" style={quietLink}>
            {officeIcon} Commissioner
          </Link>
        </CommissionerOnly>
      </div>

      <ScoreChip />

      <div
        className="gl-navend"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        <ProfileMenu />
      </div>
     </div>

      {/* The tab's ticker and its sub-tabs, under the card and sticking with
          it, so every screen in a tab carries the same strip without each page
          having to remember to draw it. */}
      {active ? (
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {active.id === "league" || active.id === "gm" ? <Ticker kind={active.id} /> : null}
          <SubTabBar tab={active} />
        </div>
      ) : (
        <div style={{ height: 8 }} />
      )}
    </div>
  );
}
