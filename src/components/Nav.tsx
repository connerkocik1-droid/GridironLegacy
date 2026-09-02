import Link from "next/link";
import CommissionerOnly from "./CommissionerOnly";
import Notices from "./Notices";
import ProfileMenu from "./ProfileMenu";

// Two doors and the draft room, and that is the whole bar.
//
// My Team is the lineup, the matchups, the watchlist, the trade builder. The
// League is the standings, the overview, the wire, the rankings, the free
// agents. Mini-games are on the home page, in their own band. Nothing that
// used to be a tab has gone anywhere — it is one press further in, and the
// bar is legible on a phone for the first time.
const PRIMARY = [
  { href: "/", label: "Home" },
  { href: "/my-team", label: "My Team" },
  { href: "/the-league", label: "The League" },
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
  padding: "10px 22px",
  borderBottom: "1px solid rgba(145,132,217,.22)",
  background: "rgba(22,24,38,.9)",
  backdropFilter: "blur(10px)",
  // Wraps rather than scrolls. A sideways scrollbar in a nav bar hides tabs
  // from anyone who does not think to drag it, and there are enough tabs now
  // that something was always being hidden on a laptop.
  flexWrap: "wrap",
  rowGap: 6,
};

const primaryLink = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(145,132,217,.28)" : undefined,
  border: active ? "1px solid rgba(181,171,252,.6)" : undefined,
  borderRadius: active ? "var(--radius-sm)" : undefined,
  color: active ? "#e9e9ed" : "#8f94a8",
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
        <div
          style={{
            width: 8,
            height: 17,
            background: "linear-gradient(180deg,#b5abfc,#5d5294)",
            boxShadow: "0 0 14px #9184d9",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-heading)",
            letterSpacing: ".2em",
            textTransform: "uppercase",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          Gridiron<span style={{ color: "#b5abfc" }}> Legacy</span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 2, marginLeft: 6, flexWrap: "wrap", rowGap: 4 }}>
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
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 10,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: "#75798c",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        {note ? <span>{note}</span> : null}
        {/* Beside the profile rather than in the tab list: it is not a place
            you go, it is the league getting your attention. */}
        <Notices />
        <ProfileMenu />
      </div>
    </div>
  );
}
