import ActivityFeed from "@/components/ActivityFeed";
import Nav from "@/components/Nav";

export const metadata = { title: "Moves · Pylon Fantasy" };

export default function ActivityPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/activity" />
      <div style={{ padding: "24px 26px 40px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>THE RECORD</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 6px",
            fontWeight: 500,
          }}
        >
          Moves
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "#9397ab",
            margin: "0 0 18px",
            maxWidth: "72ch",
            lineHeight: 1.6,
          }}
        >
          Every signing, release, waiver claim and trade this league has made, newest first. Draft
          night lives on the board rather than here.
        </p>
        <ActivityFeed />
      </div>
    </div>
  );
}
