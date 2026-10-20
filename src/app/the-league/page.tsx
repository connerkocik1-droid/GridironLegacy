import Nav from "@/components/Nav";
import AroundLeagueView from "@/components/AroundLeagueView";

export const metadata = { title: "Around the League · Pylon Fantasy" };

export default function AroundLeaguePage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/the-league" />
      <AroundLeagueView />
    </div>
  );
}
