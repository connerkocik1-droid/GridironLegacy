import Nav from "@/components/Nav";
import LeaguePowerView from "@/components/LeaguePowerView";

export const metadata = { title: "League Power · Pylon Fantasy" };

export default function LeaguePowerPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/league-power" />
      <LeaguePowerView />
    </div>
  );
}
