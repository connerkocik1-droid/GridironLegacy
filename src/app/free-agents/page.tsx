import Nav from "@/components/Nav";
import PlayersBoard from "@/components/PlayersBoard";

export const metadata = { title: "Free agents · Pylon Fantasy" };

export default function FreeAgentsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/free-agents" />
      <PlayersBoard />
    </div>
  );
}
