/**
 * Writing the injury report into the database.
 *
 * The rule worth a test is the one whose failure is silent and league-wide:
 * sync_player_health clears every player it is not handed, so the report has
 * to arrive whole. A caller that "just refreshes one man" marks everybody else
 * fit, and the first anyone knows of it is a stashed player back on a roster.
 */
import { syncReport } from "../injury-sync";

let failed = 0;
const ok = (label: string, cond: boolean, note = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? ` — ${note}` : ""}`);
  if (!cond) failed++;
};

/** A stub that records what the RPC was handed. */
function stub(known: string[], rpcResult: { data?: unknown; error?: unknown } = { data: 1 }) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    from: () => ({ select: async () => ({ data: known.map((name) => ({ name })), error: null }) }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: rpcResult.data ?? null, error: rpcResult.error ?? null };
    },
  };
  return { db, calls };
}

const ROSTER = ["Alec Pierce", "Puka Nacua", "Trey McBride", "Bijan Robinson"];

console.log("--- the report goes in whole ---");
{
  const { db, calls } = stub(ROSTER);
  const res = await syncReport(db, [
    { name: "Alec Pierce", status: "Out", detail: "Concussion" },
    { name: "Puka Nacua", status: "Questionable", detail: "Knee" },
    { name: "Trey McBride", status: "Injured Reserve", detail: "Back" },
  ]);

  ok("one call, not one per player", calls.length === 1, String(calls.length));
  const names = calls[0]?.p_names as string[];
  ok("every reported man is in it", names.length === 3, names.join(", "));

  // The whole point. Bijan is fit and is absent from the array, which is how
  // the database learns to clear him — but only because the array is the
  // entire report rather than a slice of it.
  ok("a fit man is absent, so the database clears him", !names.includes("Bijan Robinson"));

  const statuses = calls[0]?.p_statuses as string[];
  ok("statuses are the app's five, not ESPN's words",
    statuses.every((s) => ["questionable", "out", "ir", "suspended"].includes(s)),
    statuses.join(", "));
  ok("out is written as out", statuses[names.indexOf("Alec Pierce")] === "out");
  ok("and ESPN's own word is kept as the detail",
    (calls[0]?.p_details as string[])[names.indexOf("Alec Pierce")] === "Concussion");
  ok("it reports what it wrote", res.reported === 3 && res.changed === 1);
}

console.log("\n--- what is not written ---");
{
  const { db, calls } = stub(ROSTER);
  const res = await syncReport(db, [
    { name: "Alec Pierce", status: "Active", detail: "" },
    { name: "Nobody At All", status: "Out", detail: "" },
  ]);

  // Active is not a designation, and a name matching nobody is not a player.
  // Both drop out, and with nothing left there is nothing to send: an empty
  // array would clear the league, so the round trip is not even made.
  ok("an empty report makes no call", calls.length === 0);
  ok("and says so rather than claiming a write", res.reported === 0 && res.changed === 0);
  ok("an unmatched name is counted, not silently dropped", res.unmatched === 1);
}

console.log("\n--- when the database refuses ---");
{
  const { db } = stub(ROSTER, { error: { message: "nope" } });
  const res = await syncReport(db, [{ name: "Alec Pierce", status: "Out" }]);
  // Both callers have something better to do than throw: the cron reports it,
  // and the stash route carries on so the RPC can give a real answer.
  ok("it returns rather than throws", res.changed === 0 && res.reported === 1);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
