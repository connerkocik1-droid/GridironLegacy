import Link from "next/link";
import CommissionerOnly from "./CommissionerOnly";
import Notices from "./Notices";
import ProfileMenu from "./ProfileMenu";
import HeaderMark from "./HeaderMark";
import MusicToggle from "./MusicToggle";

// Three doors and the draft room, and that is the whole bar.
//
// My Team is the roster, the matchups and the watchlist. The League is the
// standings, the overview, the rankings and the news. Moves is the three
// screens where a roster changes — free agents, the trade desk, the record —
// which used to be split across the first two for no reason anybody could
// defend. Mini-games are on the home page, in their own band.
//
// Draft and Moves are both here, unlike the phone's bar below, where they
// share the fourth slot because four is all it has room for. A desktop has
// room for five, and a link that is simply always there beats one that
// appears when a state changes.
const PRIMARY = [
  { href: "/", label: "Home" },
  { href: "/my-team", label: "My Team" },
  { href: "/the-league", label: "The League" },
  { href: "/moves", label: "Moves" },
  { href: "/draft", label: "Draft" },
];

// The commissioner's own two: the office, and the room for walking through
// draft night before anybody is watching. Appended after the rest, and only
// for the manager who holds the office.
const OFFICE = [
  { href: "/draft/rehearsal", label: "Rehearsal" },
  { href: "/commissioner", label: "Commissioner" },
];

const bar: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  gap: 14,
  // Twenty-six, the same as every page's own padding, so the wordmark starts
  // on the line every heading under it starts on. It was twenty-two, which is
  // four pixels of disagreement down the whole left edge of the app.
  padding: "10px 26px",
  // The status bar is already handled: globals.css puts the safe-area insets
  // back on this element, with !important, because it is styled inline.
  borderBottom: "1px solid rgb(var(--accent-rgb) / .22)",
  background: "rgb(var(--bg-rgb) / .9)",
  backdropFilter: "blur(10px)",
  // Wraps rather than scrolls. A sideways scrollbar in a nav bar hides tabs
  // from anyone who does not think to drag it, and there are enough tabs now
  // that something was always being hidden on a laptop.
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

export default function Nav({ current, note }: { current: string; note?: string }) {
  return (
    <div className="gl-nav" style={bar}>
      <HeaderMark />

      {/* Hidden on a phone, where the same four sit in a bar at the bottom
          within a thumb's reach. Rendered either way rather than swapped, so
          there is one list of destinations in this app and not two. */}
      <div
        className="gl-navlinks"
        style={{ display: "flex", gap: 2, marginLeft: 6, flexWrap: "wrap", rowGap: 4 }}
      >
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="gl-navlink"
            style={primaryLink(item.href === current)}
          >
            {item.label}
          </Link>
        ))}
        <CommissionerOnly>
          {OFFICE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="gl-navlink"
              style={primaryLink(item.href === current)}
              aria-current={item.href === current ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
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
        {note ? <span>{note}</span> : null}
        {/* Beside the profile rather than in the tab list: it is not a place
            you go, it is the league getting your attention. */}
        <Notices />
        {/* Nothing at all off the sixteen-bit theme. */}
        <MusicToggle />
        <ProfileMenu />
      </div>
    </div>
  );
}
