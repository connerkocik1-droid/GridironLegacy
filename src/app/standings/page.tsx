import Nav from "@/components/Nav";
import StandingsView from "@/components/StandingsView";

export const metadata = { title: "Standings · Pylon Fantasy" };

export default function StandingsPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/standings" />
      <StandingsView />
    </div>
  );
}
