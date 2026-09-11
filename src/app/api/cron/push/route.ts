import { isPushConfigured, sendPush, vapidKeys } from "@/lib/push";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many devices per run. A league of twelve rarely has more than thirty. */
const BATCH = 40;

interface Claimed {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
}

/**
 * Posts what the league has been meaning to tell people.
 *
 * The whole of push on the sending side. Everything that has something to say
 * writes it to the outbox inside the transaction that noticed it, and none of
 * those places knows this exists — which is what keeps the football code free
 * of retry logic and this file free of football.
 *
 * Claim, send, settle. The claim marks rows before anything goes out so two
 * runs overlapping cannot buzz the same phone twice; the settle hands back
 * what the network refused and deletes the devices the push service says are
 * gone. Between them the worst case is a notification that arrives late, which
 * is the right worst case — the alternative is one that arrives twice.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const keys = vapidKeys();
  // Nothing is claimed when push is off. Claiming first would mark messages
  // sent that nobody could send, and they would never go out again.
  if (!keys || !isPushConfigured()) {
    return Response.json({ ok: false, reason: "push is not configured" });
  }

  const db = serviceClient();

  const { data, error } = await db.rpc("claim_push", { p_limit: BATCH });
  if (error) {
    console.error("[cron/push] could not claim", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const batch = (data ?? []) as Claimed[];
  if (!batch.length) {
    // Nothing to do is the moment to tidy. Sweeping here rather than on its
    // own schedule means one fewer cron for a table that only grows by a few
    // rows a day.
    await db.rpc("sweep_push");
    return Response.json({ ok: true, sent: 0, failed: 0 });
  }

  const sent: string[] = [];
  const delivered: string[] = [];
  const failed: string[] = [];
  const dead: string[] = [];

  // In parallel: these are a dozen independent requests to two or three push
  // services, and doing them one at a time is a minute of waiting for a
  // second of work.
  const results = await Promise.all(
    batch.map(async (row) => {
      const result = await sendPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        {
          title: row.title,
          body: row.body,
          href: row.href ?? "/",
          // The kind is the notification's tag, so four scoring updates across
          // an afternoon replace one another rather than stacking up.
          kind: row.kind,
        },
        keys,
      );
      return { row, result };
    }),
  );

  for (const { row, result } of results) {
    if (result.ok) {
      sent.push(row.id);
      delivered.push(row.endpoint);
    } else if (result.gone) {
      // The message is not the problem; the device is. Marking it sent stops
      // it being retried at a browser that no longer exists — the row for that
      // browser is deleted below.
      sent.push(row.id);
      dead.push(row.endpoint);
    } else {
      failed.push(row.id);
    }
  }

  if (sent.length) {
    const { error: sentError } = await db.rpc("push_sent", {
      p_ids: sent,
      p_endpoints: delivered,
    });
    if (sentError) console.error("[cron/push] could not mark sent", sentError);
  }

  if (failed.length || dead.length) {
    const { error: failError } = await db.rpc("push_failed", {
      p_ids: failed,
      p_dead_endpoints: dead,
    });
    if (failError) console.error("[cron/push] could not settle failures", failError);
  }

  return Response.json({
    ok: true,
    sent: delivered.length,
    failed: failed.length,
    dropped: dead.length,
  });
}
