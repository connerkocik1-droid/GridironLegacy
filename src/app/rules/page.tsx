import Nav from "@/components/Nav";
import LeagueRules from "@/components/LeagueRules";

export const metadata = { title: "How this league works · Pylon Fantasy" };

export default function RulesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/the-league" />
      <LeagueRules />
    </div>
  );
}
