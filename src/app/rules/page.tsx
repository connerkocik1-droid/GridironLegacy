import Nav from "@/components/Nav";
import LeagueRules from "@/components/LeagueRules";

export const metadata = { title: "How this league works · Gridiron Legacy" };

export default function RulesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/the-league" />
      <LeagueRules />
    </div>
  );
}
