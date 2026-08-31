import { redirect } from "next/navigation";

// Moved. This route stays so older links still work.
export default function MovedPage() {
  redirect("/minigames?game=20-0");
}
