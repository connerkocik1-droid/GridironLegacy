import Nav from "@/components/Nav";
import Standings from "@/components/Standings";

export const metadata = { title: "Standings · Pylon Fantasy" };

export default function StandingsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/standings" />
      <Standings />
    </div>
  );
}
