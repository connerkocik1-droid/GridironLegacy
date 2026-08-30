import { redirect } from "next/navigation";

// Sign-in is the landing page. This route stays so older links still work.
export default function SignInPage() {
  redirect("/");
}
