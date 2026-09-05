import Nav from "@/components/Nav";
import CommissionerOnly from "@/components/CommissionerOnly";
import PreseasonCheck from "@/components/PreseasonCheck";

export const metadata = { title: "Preseason scoring check · Pylon Fantasy" };

export default function PreseasonPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/commissioner" />
      <CommissionerOnly
        fallback={
          <div
            style={{
              maxWidth: 560,
              margin: "60px auto",
              padding: "0 18px",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.7,
            }}
          >
            This page is the commissioner&rsquo;s. It scores preseason games to check
            the maths, and the numbers on it are not anybody&rsquo;s fantasy points —
            which is exactly why it is not left where they could be mistaken for
            them.
          </div>
        }
      >
        <PreseasonCheck />
      </CommissionerOnly>
    </div>
  );
}
