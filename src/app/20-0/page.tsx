import Nav from "@/components/Nav";
import TwentyZero from "@/components/TwentyZero";

export const metadata = { title: "20-0 Mode · Gridiron Legacy" };

export default function TwentyZeroPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/20-0" />
      <TwentyZero />
    </div>
  );
}
