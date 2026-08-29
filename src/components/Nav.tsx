import Link from "next/link";

const PRIMARY = [
  { href: "/", label: "Home" },
  { href: "/draft", label: "Draft" },
  { href: "/league", label: "League" },
  { href: "/news", label: "News" },
  { href: "/commissioner", label: "Commissioner" },
];

const SECONDARY = [
  { href: "/my-team", label: "My Lineup" },
  { href: "/matchup", label: "Matchup" },
  { href: "/player-news", label: "Player News" },
  { href: "/trades", label: "Trades" },
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
  overflowX: "auto",
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

      <div style={{ display: "flex", gap: 2, marginLeft: 6, flex: "0 0 auto" }}>
        {PRIMARY.map((item) => (
          <Link key={item.href} href={item.href} style={primaryLink(item.href === current)}>
            {item.label}
          </Link>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 2,
          marginLeft: 12,
          paddingLeft: 12,
          borderLeft: "1px solid rgba(145,132,217,.22)",
          flex: "0 0 auto",
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
      </div>
    </div>
  );
}
