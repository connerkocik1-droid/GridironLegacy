"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fitChip, replacementLevels, rosterNeed, type Held } from "@/lib/moves-story";
import { player } from "@/lib/roster";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import { toggleWatch, useWatchlist } from "@/lib/use-watchlist";
import { fieldStyle } from "./menu-style";
import PlayerFace from "./PlayerFace";
import { AppView, Chips, GroupSkeleton, Note, RowGroup, type RowAction, type RowSpec, type RowTag } from "./RowList";

const POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "D/ST"] as const;
type Pos = (typeof POSITIONS)[number];

interface FreeAgent {
  name: string;
  position: string;
  team: string;
  posRank: string;
  clearsAt: string | null;
  locked?: boolean;
  points?: number;
  ppg?: number;
}

interface Feed {
  claimDay?: boolean;
  me: { id: string; franchise: string; waiver_priority: number };
  mode: "waivers" | "open" | "all";
  capacity: number;
  held: number;
  starters?: Record<string, number>;
  irLimit?: number;
  irHeld?: number;
  irEligible?: string[];
  roster: { player_name: string; lineup_slot: string; locked?: boolean }[];
  claims: { id: string; add_player: string; drop_player: string | null; claim_order: number; status: string; created_at: string }[];
  wire: { name: string; position: string; team: string; clearsAt: string; mine: boolean }[];
  total: number;
  page: number;
  hasMore: boolean;
  players: FreeAgent[];
}

/** "clears in 5h", or "clears Wednesday 1:52 AM" once it is a day off. */
function clears(iso: string) {
  const at = new Date(iso);
  const hours = (at.getTime() - Date.now()) / 3_600_000;
  if (hours <= 0) return "clears at the next run";
  if (hours < 1) return "clears within the hour";
  if (hours < 24) return `clears in ${Math.round(hours)}h`;
  return `clears ${at.toLocaleDateString(undefined, { weekday: "long" })} ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function hoursLeft(iso: string) {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

/**
 * General Manager → Free Agency: the wire, filtered by position and sorted by
 * what each man has scored. Above it, what the wire could do for this roster
 * (an upgrade on a starter, an upgrade on a reserve, or nothing); then anyone
 * recently dropped and still on waivers, and this manager's queued claims in
 * the order they will be tried. Each row carries a star for the Watchlist and
 * Add — or Claim, while he is on waivers. A full roster asks who leaves first.
 * From the Free Agency view in prototype/Pylon App.dc.html.
 */
export default function FreeAgencyView() {
  const watching = useWatchlist();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos>("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, { total: number; games: number }>>({});
  const [rostered, setRostered] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch("/api/rankings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((ranks) => {
        if (ranks?.points) setTotals(ranks.points);
        if (ranks?.rostered) setRostered(ranks.rostered);
      })
      .catch(() => {});
  }, []);

  // Points once anybody has scored any; draft position before that.
  const sort = Object.keys(totals).length ? "total" : "adp";

  const load = useCallback(async () => {
    try {
      const position = pos === "All" ? "ALL" : pos;
      const res = await fetch(
        `/api/players?position=${encodeURIComponent(position)}&q=${encodeURIComponent(search)}&page=${page}&sort=${sort}`,
        { cache: "no-store" },
      );
      if (res.status === 401) return setError("Sign in to add players.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not load the player pool.");
    }
  }, [pos, search, page, sort]);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const held = useCallback(
    (name: string): Held => ({ name, pos: player(name)?.p ?? "", points: totals[name]?.total ?? 0, games: totals[name]?.games ?? 0 }),
    [totals],
  );
  const mine = useMemo(
    () => (feed?.roster ?? []).filter((r) => r.lineup_slot !== "IR").map((r) => held(r.player_name)),
    [feed, held],
  );
  const freePool = useMemo(() => Object.keys(totals).filter((n) => !rostered[n]).map(held), [totals, rostered, held]);
  const starters = useMemo(() => feed?.starters ?? { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, "D/ST": 1 }, [feed]);
  const levels = useMemo(() => replacementLevels(freePool), [freePool]);
  const need = useMemo(() => (mine.length || freePool.length ? rosterNeed(mine, freePool, starters) : null), [mine, freePool, starters]);

  const send = async (init: RequestInit, url = "/api/waivers", fallback = "That did not go through.") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof body.error === "string" ? body.error : fallback);
      await load();
      return res.ok ? body : null;
    } catch {
      setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  };

  async function add(name: string, drop: string | null) {
    if (busy) return;
    const body = await send({ method: "POST", body: JSON.stringify({ add: name, drop }) });
    setPendingAdd(null);
    if (body)
      setNotice(
        body.mode === "now"
          ? `${name} is on your roster.${drop ? ` ${drop} went to waivers.` : ""}`
          : `Claim placed for ${name}. It settles on the next waiver run.`,
      );
  }

  async function addToIr(name: string) {
    if (busy) return;
    const body = await send({ method: "POST", body: JSON.stringify({ add: name, ir: true }) });
    if (body) setNotice(`${name} is on your injured reserve. He costs you no roster spot.`);
  }

  async function withdraw(id: string) {
    if (busy) return;
    await send({ method: "DELETE" }, `/api/waivers?id=${encodeURIComponent(id)}`);
  }

  if (error && !feed) {
    return (
      <AppView>
        <Note tag="FREE AGENCY" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!feed) {
    return (
      <AppView>
        <Chips options={[...POSITIONS]} value={pos} onChange={() => {}} label="Position" />
        <GroupSkeleton rows={10} label={false} />
      </AppView>
    );
  }

  const full = feed.held >= feed.capacity;
  const stashable = new Set(feed.irEligible ?? []);
  const irRoom = Number(feed.irHeld ?? 0) < Number(feed.irLimit ?? 0);
  const pending = feed.claims
    .filter((c) => c.status === "pending")
    .sort((a, b) => a.claim_order - b.claim_order || a.created_at.localeCompare(b.created_at));
  const claimed = new Set(pending.map((c) => c.add_player));

  async function reorder(id: string, by: -1 | 1) {
    if (busy) return;
    const ids = pending.map((c) => c.id);
    const at = ids.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    await send({ method: "PUT", body: JSON.stringify({ order: ids }) });
  }

  const addAction = (name: string, wire: boolean, locked?: boolean): RowAction => {
    const on = claimed.has(name);
    return {
      label: locked ? "LOCKED" : on ? "CLAIMED" : wire || feed.mode === "all" || feed.claimDay ? "CLAIM" : "ADD",
      on,
      disabled: busy || on || !!locked,
      onClick: () => (full ? setPendingAdd(name) : void add(name, null)),
    };
  };
  const star = (name: string): RowAction => ({
    label: watching.has(name) ? "★" : "☆",
    on: watching.has(name),
    tone: "quiet",
    ariaLabel: watching.has(name) ? `Stop watching ${name}` : `Watch ${name}`,
    onClick: () => void toggleWatch(name),
  });

  const needTag = need?.tier === "hole" ? "FILLS A HOLE" : need?.tier === "starter" ? "STARTER UPGRADE" : need?.tier === "bench" ? "BENCH UPGRADE" : "NO UPGRADES";

  const rows: RowSpec[] = feed.players.map((p) => {
    const chip = fitChip(held(p.name), mine, starters, levels);
    const tags: RowTag[] = [];
    if (p.clearsAt) tags.push({ label: `WAIVERS ${hoursLeft(p.clearsAt)}H`, tone: "warn" });
    if (chip) tags.push({ label: chip.label, tone: chip.tone === "warn" ? "warn" : "slot" });
    const games = totals[p.name]?.games ?? 0;
    const pts = p.points ?? totals[p.name]?.total;
    const actions: RowAction[] = [star(p.name)];
    if (stashable.has(p.name) && irRoom && !claimed.has(p.name) && !p.locked)
      actions.push({ label: "IR", tone: "quiet", disabled: busy, ariaLabel: `Add ${p.name} to injured reserve`, onClick: () => void addToIr(p.name) });
    actions.push(addAction(p.name, !!p.clearsAt, p.locked));
    return {
      key: p.name,
      logo: <PlayerFace name={p.name} />,
      title: p.name,
      tags,
      sub: [p.position, p.team, p.posRank ? `drafted ${p.posRank}` : null, p.locked ? "playing now, locked until next week" : null].filter(Boolean).join(" · "),
      val: pts != null ? pts.toFixed(1) : undefined,
      valSub: p.ppg != null ? `${p.ppg.toFixed(1)} PG` : games ? `${((pts ?? 0) / games).toFixed(1)} PG` : undefined,
      actions,
      onClick: () => openPlayer(p.name),
    };
  });
  if (page > 0) rows.unshift({ key: "__prev", title: "← Previous", titleColor: "var(--ap-a300)", onClick: () => setPage((n) => Math.max(0, n - 1)) });
  if (feed.hasMore) rows.push({ key: "__next", title: "More players →", titleColor: "var(--ap-a300)", sub: `${feed.total} on the wire`, onClick: () => setPage((n) => n + 1) });

  return (
    <AppView>
      <Chips
        options={[...POSITIONS]}
        value={pos}
        onChange={(v) => {
          setPos(v);
          setPage(0);
        }}
        label="Position"
      />
      {need ? <Note tag={needTag}>{need.text}</Note> : null}
      {notice ? <Note tag="DONE">{notice}</Note> : null}
      {error ? <Note tag="ERROR" tone="warn">{error}</Note> : null}

      {pendingAdd ? (
        <RowGroup
          label={`DROP FOR ${pendingAdd}`}
          note="your roster is full"
          rows={[
            ...feed.roster
              .filter((r) => r.lineup_slot !== "IR")
              .map((r) => ({
                key: r.player_name,
                logo: <PlayerFace name={r.player_name} />,
                title: r.player_name,
                sub: r.locked ? "Playing — locked until next week" : (player(r.player_name)?.t ?? ""),
                actions: [{ label: r.locked ? "LOCKED" : "DROP", disabled: busy || !!r.locked, onClick: () => void add(pendingAdd, r.player_name) }],
              })),
            { key: "__cancel", title: "Cancel", titleColor: "var(--ap-a300)", onClick: () => setPendingAdd(null) },
          ]}
        />
      ) : null}

      {feed.wire.length ? (
        <RowGroup
          label="ON WAIVERS"
          note={`${feed.wire.length} recently dropped`}
          rows={feed.wire.map((w) => ({
            key: `w:${w.name}`,
            logo: <PlayerFace name={w.name} />,
            title: w.name,
            tags: [{ label: `WAIVERS ${hoursLeft(w.clearsAt)}H`, tone: "warn" as const }],
            sub: [w.position, clears(w.clearsAt), w.mine ? "you dropped him" : null].filter(Boolean).join(" · "),
            actions: [star(w.name), addAction(w.name, true)],
            onClick: () => openPlayer(w.name),
          }))}
        />
      ) : null}

      {pending.length ? (
        <RowGroup
          label="YOUR CLAIMS"
          note={`${pending.length} queued · tried in order`}
          rows={pending.map((c, i) => ({
            key: c.id,
            num: i + 1,
            title: c.add_player,
            sub: c.drop_player ? `dropping ${c.drop_player}` : "no drop",
            actions: [
              { label: "↑", tone: "quiet" as const, disabled: busy || i === 0, ariaLabel: `Move ${c.add_player} up`, onClick: () => void reorder(c.id, -1) },
              { label: "↓", tone: "quiet" as const, disabled: busy || i === pending.length - 1, ariaLabel: `Move ${c.add_player} down`, onClick: () => void reorder(c.id, 1) },
              { label: "×", tone: "quiet" as const, disabled: busy, ariaLabel: `Withdraw the claim on ${c.add_player}`, onClick: () => void withdraw(c.id) },
            ],
          }))}
        />
      ) : null}

      <div style={{ marginBottom: 8 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search for a player…"
          aria-label="Search free agents"
          style={{ ...fieldStyle, fontSize: 12, padding: "8px 10px" }}
        />
      </div>
      <RowGroup
        label={feed.mode === "open" ? "OPEN MARKET" : "FREE AGENTS"}
        note={`Roster ${feed.held}/${feed.capacity}${feed.mode === "open" ? "" : ` · priority #${feed.me.waiver_priority}`}`}
        rows={rows}
        empty={{ title: search ? `Nobody matching “${search}”` : "Nobody left at this position", sub: "Try another filter." }}
      />
    </AppView>
  );
}
