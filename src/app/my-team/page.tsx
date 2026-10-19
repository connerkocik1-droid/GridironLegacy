import Nav from "@/components/Nav";
import RosterView from "@/components/RosterView";

export const metadata = { title: "Roster · Pylon Fantasy" };

export default function MyTeamPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/my-team" />
      <RosterView />
    </div>
  );
}
