import Nav from "@/components/Nav";
import Commissioner from "@/components/Commissioner";

export const metadata = { title: "Commissioner · Gridiron Legacy" };

export default function CommissionerPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/commissioner" />
      <Commissioner />
    </div>
  );
}
