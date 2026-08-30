import Nav from "@/components/Nav";
import TradeDesk from "@/components/TradeDesk";

export const metadata = { title: "Trades · Gridiron Legacy" };

export default function TradesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/trades" />
      <TradeDesk />
    </div>
  );
}
