import Nav from "@/components/Nav";
import LeagueHub from "@/components/LeagueHub";

export const metadata = { title: "The League · Pylon Fantasy" };

export default function TheLeaguePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/the-league" />
      <LeagueHub />
    </div>
  );
}
