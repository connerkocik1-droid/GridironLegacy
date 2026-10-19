"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CommissionerOnly from "./CommissionerOnly";
import Notices from "./Notices";
import ProfileMenu from "./ProfileMenu";
import HeaderMark from "./HeaderMark";
import { APP_TABS, appTabFor } from "@/lib/app-tabs";
import { blip } from "@/lib/retro";

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

// The liquid-glass treatment from the redesign handoff: a two-stop gradient
// over a heavy blur, a hairline border, and an inset top highlight — rather
// than the flat translucent fill this bar used before.
const bar: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "10px 26px",
  border: "1px solid rgb(var(--accent-rgb) / .1)",
  borderTop: "none",
  borderLeft: "none",
  borderRight: "none",
  background:
    "linear-gradient(180deg,rgb(var(--accent-rgb) / .09),rgb(var(--bg-rgb) / .86))",
  backdropFilter: "blur(22px) saturate(160%)",
  WebkitBackdropFilter: "blur(22px) saturate(160%)",
  boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .14)",
  flexWrap: "wrap",
  rowGap: 6,
};

const primaryLink = (active: boolean): React.CSSProperties => ({
  background: active ? "rgb(var(--accent-rgb) / .28)" : undefined,
  border: active ? "1px solid rgb(var(--accent-bright-rgb) / .6)" : undefined,
  borderRadius: active ? "var(--radius-sm)" : undefined,
  color: active ? "var(--text)" : "var(--text-quiet)",
  fontSize: 11,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  padding: "8px 12px",
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
    // data-panel="bar": in sixteen-bit mode the header is a full-width bar
    // with a gold bottom edge, the tab bar's mirror image.
    <div className="gl-nav" data-panel="bar" style={bar}>
      <HeaderMark />

      {/* Hidden on a phone, where the same three sit in a bar at the bottom
          within a thumb's reach. */}
      <div
        className="gl-navlinks"
        style={{ display: "flex", gap: 2, marginLeft: 6, flexWrap: "wrap", rowGap: 4 }}
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

      <div
        className="gl-navend"
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 10,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        <Notices />
        <ProfileMenu />
      </div>
    </div>
  );
}
