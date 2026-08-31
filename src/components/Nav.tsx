import Link from "next/link";
import CommissionerOnly from "./CommissionerOnly";
import ProfileMenu from "./ProfileMenu";

const PRIMARY = [
  { href: "/", label: "Home" },
  { href: "/lineup", label: "Lineup" },
  { href: "/matchups", label: "Matchups" },
  { href: "/standings", label: "Standings" },
  { href: "/rankings", label: "Rankings" },
  { href: "/draft", label: "Draft" },
];

// The commissioner's own two: the office, and the room for walking through
// draft night before anybody is watching. Appended after the rest, and only
// for the manager who holds the office.
const OFFICE = [
  { href: "/draft/rehearsal", label: "Rehearsal" },
  { href: "/commissioner", label: "Commissioner" },
];

// Where a manager goes to change their roster, plus the reading matter.
const SECONDARY = [
  { href: "/free-agents", label: "Free Agents" },
  { href: "/trade-builder", label: "Trade Builder" },
  { href: "/league", label: "League" },
  { href: "/news", label: "News" },
  { href: "/minigames", label: "Mini-games" },
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

const secondaryLink = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(145,132,217,.2)" : undefined,
  border: active ? "1px solid rgba(181,171,252,.45)" : undefined,
  borderRadius: active ? "var(--radius-sm)" : undefined,
  color: active ? "#e9e9ed" : "#75798c",
  fontSize: 10,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  padding: "6px 11px",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
  textDecoration: "none",
});

export default function Nav({ current, note }: { current: string; note?: string }) {
  return (
    <div style={bar}>
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
          <Link key={item.href} href={item.href} style={primaryLink(item.href === current)}>
            {item.label}
          </Link>
        ))}
        <CommissionerOnly>
          {OFFICE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
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
          display: "flex",
          gap: 2,
          marginLeft: 12,
          paddingLeft: 12,
          borderLeft: "1px solid rgba(145,132,217,.22)",
          flexWrap: "wrap",
          rowGap: 4,
        }}
      >
        {SECONDARY.map((item) => (
          <Link key={item.href} href={item.href} style={secondaryLink(item.href === current)}>
            {item.label}
          </Link>
        ))}
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
        <ProfileMenu />
      </div>
    </div>
  );
}
