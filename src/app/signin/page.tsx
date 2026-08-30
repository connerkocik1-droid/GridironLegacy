import SignIn from "@/components/SignIn";

export const metadata = { title: "Sign in · Gridiron Legacy" };

export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <SignIn />
    </div>
  );
}
