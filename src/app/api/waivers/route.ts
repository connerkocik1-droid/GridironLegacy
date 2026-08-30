import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

async function me(db: Awaited<ReturnType<typeof serverClient>>) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  return data;
}

/**
 * Adds a player.
 *
 * In open mode the add happens now. Otherwise it queues a claim for the
 * scheduled run, because someone else may want the same player and the run is
 * what settles that in priority order.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const manager = await me(db);
  if (!manager) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { add?: unknown; drop?: unknown; claimOrder?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const add = typeof body.add === "string" ? body.add : "";
  const drop = typeof body.drop === "string" && body.drop ? body.drop : null;
  if (!add) return Response.json({ error: "Name the player to add" }, { status: 400 });

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", manager.league_id)
    .single();

  const open = league?.settings?.waiverMode === "open";

  if (open) {
    const { data, error } = await db.rpc("add_player", {
      p_league_id: manager.league_id,
      p_add: add,
      p_drop: drop,
    });

    if (error) {
      const taken = error.code === "23505";
      return Response.json({ error: error.message }, { status: taken ? 409 : 400 });
    }
    return Response.json({ ...data, mode: "open" });
  }

  const claimOrder = Number(body.claimOrder ?? 1);
  const { data, error } = await db
    .from("waiver_claims")
    .insert({
      league_id: manager.league_id,
      manager_id: manager.id,
      add_player: add,
      drop_player: drop,
      claim_order: Number.isInteger(claimOrder) && claimOrder > 0 ? claimOrder : 1,
    })
    .select("id")
    .single();

  if (error) {
    // The unique index means a manager cannot queue the same player twice.
    const duplicate = error.code === "23505";
    return Response.json(
      { error: duplicate ? "You have already claimed him" : "Could not place that claim" },
      { status: duplicate ? 409 : 400 },
    );
  }

  return Response.json({ ok: true, mode: "waivers", claimId: data.id });
}

/** Withdraws a pending claim. */
export async function DELETE(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const manager = await me(db);
  if (!manager) return Response.json({ error: "Not signed in" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await db
    .from("waiver_claims")
    .update({ status: "cancelled", settled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("manager_id", manager.id)
    .eq("status", "pending");

  if (error) return Response.json({ error: "Could not withdraw that claim" }, { status: 400 });
  return Response.json({ ok: true });
}

/** Drops a player outright. */
export async function PATCH(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const manager = await me(db);
  if (!manager) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { drop?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const drop = typeof body.drop === "string" ? body.drop : "";
  if (!drop) return Response.json({ error: "Name the player to drop" }, { status: 400 });

  const { data, error } = await db.rpc("drop_player", {
    p_league_id: manager.league_id,
    p_player: drop,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json(data);
}
