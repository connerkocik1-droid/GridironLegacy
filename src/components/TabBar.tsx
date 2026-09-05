"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CommissionerOnly from "./CommissionerOnly";
import { useMe } from "@/lib/use-me";
import { useChatUnread } from "@/lib/use-chat-unread";

/**
 * The four places, where a thumb can reach them.
 *
 * The bar has always been at the top of the screen, which on a phone is the
 * one part of it a thumb cannot get to. This app is used one-handed, standing
 * up, during a game — and every navigation meant either a stretch or a second
 * hand. Launched from a home screen it is worse: there is no browser chrome at
 * the bottom any more, so the whole of the easiest third of the screen was
 * doing nothing.
 *
 * It is the same four destinations, not a new menu. The top bar keeps the
 * wordmark, the bell and the avatar and gives up its links on a phone, because
 * two navigations are worse than one wherever they are.
 *
 * A tab is active for everywhere it owns rather than only for its own page:
 * the lineup, the matchups and the watchlist are all My Team, and a manager
 * three pages deep should still be able to see where they are.
 */

interface Tab {
  href: string;
  label: string;
  /** Everywhere this tab is the answer to "where am I". */
  owns: string[];
  icon: React.ReactNode;
}

/** One stroke weight, one size, no fills: they are read at eleven pixels. */
const glyph = (d: React.ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="21"
    height="21"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);

const TABS: Tab[] = [
  {
    href: "/",
    label: "Home",
    // The mini-games live in a band on the home page, so they answer to it.
    owns: ["/", "/minigames", "/pickem", "/20-0"],
    icon: glyph(
      <>
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6 9.6V20h12V9.6" />
      </>,
    ),
  },
  {
    href: "/my-team",
    label: "My Team",
    owns: ["/my-team", "/lineup", "/matchups", "/watchlist", "/trade-builder", "/trades", "/player"],
    icon: glyph(
      <>
        <path d="M9 4 5 6v5h3v9h8v-9h3V6l-4-2" />
        <path d="M9 4a3 3 0 0 0 6 0" />
      </>,
    ),
  },
  {
    href: "/the-league",
    label: "League",
    owns: [
      "/the-league", "/standings", "/league", "/news", "/player-news",
      "/rankings", "/free-agents", "/activity", "/rules", "/chat",
    ],
    icon: glyph(
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </>,
    ),
  },
  {
    href: "/draft",
    label: "Draft",
    owns: ["/draft"],
    icon: glyph(
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9.5h16M9.5 9.5V20" />
      </>,
    ),
  },
];

const OFFICE: Tab = {
  href: "/commissioner",
  label: "Office",
  owns: ["/commissioner", "/draft/rehearsal"],
  icon: glyph(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </>,
  ),
};

/** Which tab owns a path. The longest claim wins, so /draft/rehearsal is the office. */
function activeTab(pathname: string, tabs: Tab[]): string | null {
  let best: { href: string; length: number } | null = null;

  for (const tab of tabs) {
    for (const owned of tab.owns) {
      const hit = owned === "/" ? pathname === "/" : pathname === owned || pathname.startsWith(`${owned}/`);
      if (hit && (!best || owned.length > best.length)) {
        best = { href: tab.href, length: owned.length };
      }
    }
  }

  return best?.href ?? null;
}

export default function TabBar({ signedIn }: { signedIn: boolean }) {
  const me = useMe();
  const pathname = usePathname() ?? "/";

  // A dot on League when somebody has said something. Not a number: at this
  // size a count is unreadable, and "there is something" is the whole of what
  // a tab bar has room to say. The count itself is on the chat card, one press
  // in, where there is room for it.
  const unread = useChatUnread(me.status === "signed-in");

  // Nothing for a signed-out visitor. The home page turns into the sign-in
  // screen and deliberately shows no navigation, because every destination
  // behind it would only ask them to sign in — a bar of four such links across
  // the bottom of that screen would be four ways of being told no. A league
  // that has no database yet is the same case.
  //
  // But "signed in" is answered by the server, in the layout, from the cookie
  // it already read — and only refined by the browser afterwards. It used to
  // be the browser's answer alone, and useMe made one request with no retry:
  // when that request was dropped the state stayed "checking" for the life of
  // the page and this bar rendered nothing, for ever, while every board around
  // it loaded fine because each fetches its own data.
  //
  // A tab is a rare thing to lose a first request in. A home-screen app is
  // launched cold and resumed from the background, so it is the common case
  // there — which is why the tabs were missing in the PWA and only in the PWA.
  // The server knew the whole time.
  const showing = me.status === "checking" ? signedIn : me.status === "signed-in";

  // The room the bar takes up is reserved in CSS, which cannot know whether
  // anybody is signed in — so the bar says so here. Without it the sign-in
  // screen, the first thing anybody ever sees, ends with fifty-eight pixels of
  // nothing held open for a bar that is not there.
  useEffect(() => {
    if (!showing) return;
    document.documentElement.dataset.tabbar = "1";
    return () => {
      delete document.documentElement.dataset.tabbar;
    };
  }, [showing]);

  if (!showing) return null;

  const all = [...TABS, OFFICE];
  const active = activeTab(pathname, all);

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
        // `display` is deliberately absent here and set in globals.css, which
        // is the only place that knows how wide the screen is. Setting it
        // inline would beat the stylesheet at every width, and the first
        // version of this did exactly that — a desktop got the bottom bar and
        // the top links at once, which is the one thing it must not do.
        // Above the home indicator, not under the bar somebody swipes to leave.
        paddingBottom: "env(safe-area-inset-bottom)",
        borderTop: "1px solid rgb(var(--accent-rgb) / .22)",
        background: "rgb(var(--sunken-rgb) / .94)",
        backdropFilter: "blur(14px)",
      }}
    >
      {TABS.map((tab) => (
        <TabLink
          key={tab.href}
          tab={tab}
          active={active === tab.href}
          dot={tab.href === "/the-league" && unread > 0 && !pathname.startsWith("/chat")}
        />
      ))}
      <CommissionerOnly>
        <TabLink tab={OFFICE} active={active === OFFICE.href} />
      </CommissionerOnly>
    </nav>
  );
}

function TabLink({ tab, active, dot }: { tab: Tab; active: boolean; dot?: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      // The dot is decoration and carries no text, so the link says what it
      // means instead. Without this a screen reader gets "League" either way.
      aria-label={dot ? `${tab.label} — new messages` : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        // Comfortably past the thumb-target floor, because this is the control
        // pressed more than any other in the app.
        minHeight: 52,
        padding: "7px 2px 8px",
        textDecoration: "none",
        position: "relative",
        color: active ? "var(--accent-text)" : "var(--text-quiet)",
        // The lit tab is also a lit panel. Colour alone was carrying "you are
        // here" on a bar that is read at a glance and often in sunlight.
        background: active
          ? "linear-gradient(180deg,rgb(var(--accent-rgb) / .16),transparent 72%)"
          : "transparent",
      }}
    >
      {/* The filament. It draws itself out from the middle when the tab
          becomes the current one, which is the app's only acknowledgement
          that the press landed — the page underneath is still arriving. */}
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

      <span style={{ position: "relative", display: "inline-flex", flex: "0 0 auto" }}>
        {tab.icon}
        {dot ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -1,
              right: -2,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--accent-link)",
              // Against the bar rather than against the icon, so it reads as a
              // mark on the tab and not as part of the glyph.
              boxShadow: "0 0 0 2px rgb(var(--sunken-rgb) / .94)",
            }}
          />
        ) : null}
      </span>
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
