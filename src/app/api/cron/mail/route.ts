import { isMailConfigured, sendNoticeMail, type NoticeMail } from "@/lib/mail";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** How many go out per run. A league of twelve rarely makes more in a minute. */
const BATCH = 25;

/**
 * Posts the notices nobody has been told about outside the app.
 *
 * The whole of the email feature, on the sending side: everything that raises
 * a notice already did so, transactionally, and none of it knows this exists.
 *
 * Claim, send, release what failed. The claim marks the rows before anything
 * is sent, so two runs overlapping cannot post the same notice twice; the
 * release hands back whatever the provider would not take, so a bad afternoon
 * costs delay rather than the notice. Between those two the worst case is a
 * message that arrives late, which is the right worst case for this.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Nothing is claimed when mail is off. Claiming first would mark notices
  // delivered that nobody could deliver, and they would never be sent again.
  if (!isMailConfigured()) {
    return Response.json({ ok: false, reason: "mail is not configured" });
  }

  const db = serviceClient();

  const { data, error } = await db.rpc("claim_notice_mail", { p_limit: BATCH });
  if (error) {
    console.error("[cron/mail] could not claim", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const batch: NoticeMail[] = (data ?? []).map(
    (row: {
      notice_id: string;
      email: string;
      franchise: string;
      kind: string;
      body: string;
      href: string | null;
    }) => ({
      noticeId: row.notice_id,
      email: row.email,
      franchise: row.franchise,
      kind: row.kind,
      body: row.body,
      href: row.href,
    }),
  );

  if (!batch.length) return Response.json({ ok: true, sent: 0, failed: 0 });

  const { sent, failed } = await sendNoticeMail(batch);

  if (failed.length) {
    const { error: released } = await db.rpc("release_notice_mail", { p_ids: failed });
    // A failed release is the one case that loses a notice for good, so it is
    // logged loudly rather than folded into the count.
    if (released) console.error("[cron/mail] could not release failures", released);
  }

  return Response.json({ ok: true, sent: sent.length, failed: failed.length });
}
