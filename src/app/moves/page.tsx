import { redirect } from "next/navigation";

/**
 * The old Moves hub, folded into the General Manager tab: Free Agents is Free
 * Agency, Trade Builder is Trades and The Record is Transactions. Kept as a
 * redirect so a saved link or an old notice still lands somewhere — with any
 * trade it was carrying (?with=, ?want=, ?give=) carried across.
 */
export default async function MovesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : "";
  if (tab === "trade-builder") {
    const keep = new URLSearchParams();
    for (const key of ["with", "want", "give"]) {
      const v = params[key];
      if (typeof v === "string") keep.set(key, v);
    }
    redirect(`/trade-builder${keep.size ? `?${keep}` : ""}`);
  }
  if (tab === "the-record") redirect("/activity");
  redirect("/free-agents");
}
