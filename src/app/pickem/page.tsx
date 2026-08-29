import Nav from "@/components/Nav";
import PickemBoard from "@/components/PickemBoard";

export const metadata = { title: "Pick-'Em · Gridiron Legacy" };

export default function PickemPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/pickem" />
      <PickemBoard />
    </div>
  );
}
