import Nav from "@/components/Nav";
import LeagueChat from "@/components/LeagueChat";

export const metadata = { title: "League chat · Pylon Fantasy" };

export default function ChatPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/the-league" />
      <LeagueChat />
    </div>
  );
}
