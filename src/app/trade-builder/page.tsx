import Nav from "@/components/Nav";
import TradesView from "@/components/TradesView";

export const metadata = { title: "Trades · Pylon Fantasy" };

export default function TradeBuilderPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/trade-builder" />
      <TradesView />
    </div>
  );
}
