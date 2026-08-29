import Nav from "@/components/Nav";
import { TEAMS, TEAM_NAMES, POOL, logo } from "@/data/league-data";

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/" note="Week 1 · lineup locks Sun 1:00" />

      <div style={{ padding: "24px 26px" }}>
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
          DYNASTY · 12 TEAM · SUPERFLEX
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 44,
            lineHeight: 1.04,
            letterSpacing: "-.035em",
            margin: "8px 0 24px",
          }}
        >
          Gridiron Legacy
        </div>

        <div style={{ fontSize: 12, color: "#9397ab", marginBottom: 20 }}>
          {POOL.length} players in the pool · {TEAMS.length} franchises
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
            gap: 10,
          }}
        >
          {TEAMS.map((slot: string) => (
            <div
              key={slot}
              style={{
                border: "1px solid rgba(145,132,217,.22)",
                borderRadius: "var(--radius-md)",
                padding: "12px 14px",
                background: "rgba(35,37,50,.6)",
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c" }}>{slot}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, marginTop: 4 }}>
                {TEAM_NAMES[slot]}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 24, flexWrap: "wrap" }}>
          {["buf", "phi", "kc", "sf", "det", "bal"].map((abbr) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={abbr} src={logo(abbr)} alt={abbr} width={28} height={28} />
          ))}
        </div>
      </div>
    </div>
  );
}
