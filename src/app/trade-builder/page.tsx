import Nav from "@/components/Nav";
import TradeDesk from "@/components/TradeDesk";

export const metadata = { title: "Trade builder · Pylon Fantasy" };

export default function TradeBuilderPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/trade-builder" />
      <TradeDesk />
    </div>
  );
}
