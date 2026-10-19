import Nav from "@/components/Nav";
import LeaguePowerBoard from "@/components/LeaguePowerBoard";

export const metadata = { title: "League Power · Pylon Fantasy" };

export default function LeaguePowerPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/league-power" />
      <LeaguePowerBoard />
    </div>
  );
}
