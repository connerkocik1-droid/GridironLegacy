"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TeamMark from "./TeamMark";
import { player, proj } from "@/lib/roster";
import { balancer, fitScore, pickValue, verdict, type Held } from "@/lib/moves-story";

interface Manager {
  id: string;
  slot: string;
  franchise: string;
}

interface Pick {
  id: string;
  season: number;
  round: number;
  /** Where it falls in its round; null until the order has been computed. */
  slot: number | null;
  manager_id: string;
  /** Whose record places it. Unchanged by a trade. */
  origin_manager: string;
  tradeable: boolean;
}

interface Trade {
  id: string;
  from_manager: string;
  to_manager: string;
  offer: { give: string[]; get: string[]; givePicks?: string[]; getPicks?: string[] };
  status: "open" | "countered" | "agreed" | "executed" | "declined" | "rescinded";
  from_accepted: boolean;
  to_accepted: boolean;
  thread: { who: string; at: string; text: string }[];
  created_at: string;
  incoming: boolean;
  awaitingMe: boolean;
  /** Your terms are on the table and they have not taken them yet. */
  canRescind: boolean;
}

interface Desk {
  /** What the league fields at each position. */
  starters?: Record<string, number>;
  me: Manager & { league_id: string };
  managers: Manager[];
  block: { player_name: string; manager_id: string }[];
  picks: Pick[];
  inauguralSeason: number | null;
  trades: Trade[];
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

/** Everybody but the reader. */
function partnersOf(desk: Desk) {
  return desk.managers.filter((m) => m.id !== desk.me.id);
}

function ordinal(n: number): string {
  return ORDINAL[n] ?? `${n}th`;
}

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
};

const STATUS_COLOR: Record<Trade["status"], string> = {
  open: "var(--accent-link)",
  countered: "var(--warn)",
  agreed: "var(--good)",
  executed: "var(--good)",
  declined: "var(--text-dim)",
  rescinded: "var(--text-dim)",
};

/**
 * The draft picks one side holds, offerable or not.
 *
 * Picks for the inaugural draft are listed but cannot be chosen. Hiding them
 * would leave a manager wondering where their first-rounder went; showing them
 * greyed out with the reason answers the question before it is asked.
 */
function PickList({
  picks,
  chosen,
  onToggle,
  label,
}: {
  picks: Pick[];
  chosen: string[];
  onToggle: (id: string) => void;
  label: (p: Pick) => string;
}) {
  if (!picks.length) return null;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid rgb(var(--accent-rgb) / .16)", paddingTop: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 7 }}>
        DRAFT PICKS
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {picks.map((p) => (
          <button
            key={p.id}
            onClick={() => p.tradeable && onToggle(p.id)}
            disabled={!p.tradeable}
            title={p.tradeable ? undefined : "The inaugural draft cannot be traded"}
            style={{
              ...rowButton(chosen.includes(p.id)),
              cursor: p.tradeable ? "pointer" : "default",
              opacity: p.tradeable ? 1 : 0.4,
            }}
          >
            {label(p)}
            {!p.tradeable ? (
              <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>LOCKED</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const p = player(name);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        margin: "0 4px 4px 0",
        border: "1px solid rgb(var(--accent-rgb) / .3)",
        borderRadius: "var(--radius-sm)",
        background: "rgb(var(--sunken-rgb) / .7)",
        fontSize: 12,
      }}
    >
      <TeamMark team={p?.t} size={14} opacity={1} />
      {name}
      <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{proj(name).toFixed(1)}</span>
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          style={{
            border: "none",
            background: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            font: "inherit",
            padding: 0,
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

async function fetchRoster(managerId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/rosters?manager=${encodeURIComponent(managerId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.players) ? body.players : [];
  } catch {
    return [];
  }
}

export default function TradeDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partner, setPartner] = useState("");
  const [give, setGive] = useState<string[]>([]);
  const [want, setWant] = useState<string[]>([]);
  const [givePicks, setGivePicks] = useState<string[]>([]);
  const [getPicks, setGetPicks] = useState<string[]>([]);
  const [myRoster, setMyRoster] = useState<string[]>([]);
  const [theirRoster, setTheirRoster] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Season scoring and who holds whom, from one request. The rostered map is
  // every player in the league keyed to his franchise, which is enough to
  // rebuild all twelve rosters without asking for them one at a time.
  const [totals, setTotals] = useState<Record<string, { total: number; games: number }>>({});
  const [rostered, setRostered] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch("/api/rankings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((ranks) => {
        if (ranks?.points) setTotals(ranks.points);
        if (ranks?.rostered) setRostered(ranks.rostered);
      });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trades", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to trade.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setDesk(await res.json());
      setError(null);
    } catch {
      setError("Could not load the trade desk.");
    }
  }, []);

  useEffect(() => {
    // As in PickemBoard: `load` sets state only once its request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Rosters come from the server so they reflect trades other managers made.
  // Each fetch is abandoned if its manager changes first, so a slow response
  // for a previous partner cannot overwrite the current one.
  useEffect(() => {
    const id = desk?.me.id;
    if (!id) return;

    const cancelled = { current: false };
    fetchRoster(id).then((players) => {
      if (!cancelled.current) setMyRoster(players);
    });

    return () => {
      cancelled.current = true;
    };
  }, [desk?.me.id]);

  useEffect(() => {
    const cancelled = { current: false };

    if (!partner) {
      // Clearing runs through the same async path, so it can never land after
      // a fetch that was already in flight.
      Promise.resolve([] as string[]).then((players) => {
        if (!cancelled.current) setTheirRoster(players);
      });
    } else {
      fetchRoster(partner).then((players) => {
        if (!cancelled.current) setTheirRoster(players);
      });
    }

    return () => {
      cancelled.current = true;
    };
  }, [partner]);

  const managerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of desk?.managers ?? []) map.set(m.id, m.franchise);
    return map;
  }, [desk]);

  // "2027 1st", plus who it came from once it is not the holder's own — a
  // pick's worth is the record behind it, so the name on it matters.
  const franchiseOf = (id: string) =>
    desk?.managers.find((m) => m.id === id)?.franchise ?? "";

  function pickLabel(p: Pick): string {
    const own = p.origin_manager === p.manager_id;
    const where = p.slot ? ` · pick ${p.slot}` : "";
    return `${p.season} ${ordinal(p.round)}${own ? "" : ` (${franchiseOf(p.origin_manager)})`}${where}`;
  }

  const picksHeldBy = (id: string) =>
    (desk?.picks ?? []).filter((p) => p.manager_id === id);

  /**
   * Pick ids from an old offer, as names.
   *
   * A pick that no longer exists — the franchise it came from was removed —
   * is named as such rather than dropped, so the history of a trade does not
   * quietly shrink.
   */
  function namePicks(ids: string[] | undefined): string[] {
    return (ids ?? []).map((id) => {
      const pick = desk?.picks.find((p) => p.id === id);
      return pick ? pickLabel(pick) : "a pick that no longer exists";
    });
  }

  const empty =
    !give.length && !want.length && !givePicks.length && !getPicks.length;

  // What each side of the offer is actually worth.
  //
  // Season points, not projection: a trade is judged on what a man has done
  // this year, and the desk used to value him by a preseason estimate that
  // stops being the interesting number the moment a week is played. Before
  // anything has been scored the projection is still the only answer, so it
  // remains the fallback rather than showing a table of noughts.
  const worth = useCallback(
    (name: string) => {
      const row = totals[name];
      return row && row.games > 0 ? row.total : proj(name);
    },
    [totals],
  );

  // A pick is worth its round and where the standings currently place it, so
  // the same second-rounder is worth more to a team going badly. Slot is only
  // known once the order has been computed; until then the round carries it.
  const pickWorth = useCallback(
    (id: string) => {
      const pick = desk?.picks.find((p) => p.id === id);
      if (!pick) return 0;
      return pickValue(pick.round, pick.slot ?? 6, desk?.managers.length || 12);
    },
    [desk],
  );

  const giveValue =
    give.reduce((s, n) => s + worth(n), 0) + givePicks.reduce((s, id) => s + pickWorth(id), 0);
  const wantValue =
    want.reduce((s, n) => s + worth(n), 0) + getPicks.reduce((s, id) => s + pickWorth(id), 0);
  const gap = wantValue - giveValue;

  function toggle(list: string[], set: (v: string[]) => void, name: string) {
    set(list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  }

  async function send() {
    if (!partner || empty) return;
    setBusy(true);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: partner, give, get: want, givePicks, getPicks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Offer was not sent.");
      } else {
        setGive([]);
        setWant([]);
        setGivePicks([]);
        setGetPicks([]);
        setError(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function respond(trade: Trade, action: "accept" | "decline" | "rescind") {
    setBusy(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That did not go through.");
      else setError(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !desk) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!desk) {
    return <div style={{ padding: "24px 26px", color: "var(--text-dim)" }}>Opening the trade desk…</div>;
  }

  // Every roster in the league, rebuilt from the one map the rankings route
  // already sends, so ranking partners costs no extra request.
  const rostersOf = (franchise: string): Held[] =>
    Object.keys(rostered)
      .filter((n) => rostered[n] === franchise)
      .map((n) => ({
        name: n,
        pos: player(n)?.p ?? "",
        points: totals[n]?.total ?? 0,
        games: totals[n]?.games ?? 0,
      }));

  const starters = desk.starters && Object.keys(desk.starters).length
    ? desk.starters
    : { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, "D/ST": 1 };

  const myHeld = rostersOf(desk.me.franchise);

  /**
   * Best fit first, and a diamond on the best of them.
   *
   * A position counts only where one side is genuinely short and the other
   * genuinely deep — crediting surplus alone makes every manager somebody's
   * best partner, and a badge everybody wears says nothing. Which is also why
   * the diamond disappears entirely when nobody scores.
   */
  const fits = new Map(
    partnersOf(desk).map((m) => [m.id, fitScore(myHeld, rostersOf(m.franchise), starters)]),
  );
  const topFit = Math.max(0, ...fits.values());

  const partners = partnersOf(desk)
    .slice()
    .sort((a, b) => (fits.get(b.id) ?? 0) - (fits.get(a.id) ?? 0) || a.franchise.localeCompare(b.franchise));

  // The single pick that would even up a lopsided offer, if one would. Only
  // from the side that is behind, and only when it actually lands the deal
  // near even — a suggestion that leaves the gap where it was looks like
  // advice and costs a tap to find out it is not.
  const sweetener = balancer(
    gap,
    (desk.picks ?? [])
      .filter((p) => p.tradeable)
      .filter((p) =>
        gap > 0
          ? p.manager_id === desk.me.id && !givePicks.includes(p.id)
          : p.manager_id === partner && !getPicks.includes(p.id),
      )
      .map((p) => ({
        id: p.id,
        label: `${p.season} ${ordinal(p.round)}`,
        value: pickValue(p.round, p.slot ?? 6, desk.managers.length || 12),
      })),
    managerName.get(partner) ?? "they",
  );

  return (
    <>
      <div style={{ padding: "24px 26px 12px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>TRADE DESK</div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(28px, 7.6vw, 44px)",
            lineHeight: 1.04,
            letterSpacing: "-.035em",
            margin: "8px 0 0",
          }}
        >
          {desk.me.franchise}
        </div>
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "var(--warn)" }}>{error}</div>
      ) : null}

      <div className="gl-cols"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(300px,380px)",
          gap: 18,
          padding: "12px 26px 40px",
          alignItems: "start",
        }}
      >
        <div style={{ ...card, padding: "16px 18px" }}>
          <h6 style={{ margin: "0 0 10px", color: "var(--accent-text)" }}>Build an offer</h6>

          <label style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)" }}>
            TRADE WITH
          </label>
          <select
            value={partner}
            onChange={(e) => {
              setPartner(e.target.value);
              setWant([]);
              // Their picks belong to whoever was selected; keeping them
              // across a change of partner would offer a pick they never had.
              setGetPicks([]);
            }}
            style={{
              width: "100%",
              margin: "6px 0 16px",
              padding: "8px 10px",
              background: "rgb(var(--sunken-rgb) / .8)",
              color: "var(--text)",
              border: "1px solid rgb(var(--accent-rgb) / .3)",
              borderRadius: "var(--radius-sm)",
              font: "inherit",
            }}
          >
            <option value="">Pick a manager…</option>
            {partners.map((m) => (
              <option key={m.id} value={m.id}>
                {m.franchise}
                {topFit > 0 && fits.get(m.id) === topFit ? " ◆" : ""}
              </option>
            ))}
          </select>

          {/* The two sides sit side by side so a manager reads the deal as one
              exchange rather than two lists. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 8 }}>
                YOU SEND · {giveValue.toFixed(1)}
              </div>
              <div style={{ minHeight: 34, marginBottom: 8 }}>
                {give.map((n) => (
                  <PlayerChip key={n} name={n} onRemove={() => toggle(give, setGive, n)} />
                ))}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {/* Said on this side too, so the column is not simply blank
                    before the draft. Players only — any picks this manager
                    holds are listed below and are tradeable from day one. */}
                {myRoster.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    No players until you have drafted.
                  </div>
                ) : null}
                {myRoster.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggle(give, setGive, n)}
                    style={rowButton(give.includes(n))}
                  >
                    {n}
                    <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 11 }}>
                      {proj(n).toFixed(1)}
                    </span>
                  </button>
                ))}
              </div>

              <PickList
                picks={picksHeldBy(desk.me.id)}
                chosen={givePicks}
                onToggle={(id) => toggle(givePicks, setGivePicks, id)}
                label={pickLabel}
              />
            </div>

            <div>
              <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 8 }}>
                YOU GET · {wantValue.toFixed(1)}
              </div>
              <div style={{ minHeight: 34, marginBottom: 8 }}>
                {want.map((n) => (
                  <PlayerChip key={n} name={n} onRemove={() => toggle(want, setWant, n)} />
                ))}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {!partner ? (
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Pick a manager first.</div>
                ) : null}
                {theirRoster.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggle(want, setWant, n)}
                    style={rowButton(want.includes(n))}
                  >
                    {n}
                    <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 11 }}>
                      {proj(n).toFixed(1)}
                    </span>
                  </button>
                ))}
              </div>

              {partner ? (
                <PickList
                  picks={picksHeldBy(partner)}
                  chosen={getPicks}
                  onToggle={(id) => toggle(getPicks, setGetPicks, id)}
                  label={pickLabel}
                />
              ) : null}
            </div>
          </div>

          {/* A row rather than a button with a sentence flowing round it. On a
              phone the caption wrapped past the button and left "— judge the
              deal yourself." stranded on a line of its own underneath, which
              reads as a fragment somebody forgot to delete. */}
          {/* What the offer amounts to, and the one pick that would even it
              up. Both generated: the verdict turns over between an empty
              selection, a close deal and a lopsided one rather than resolving
              to a single sentence, and the sweetener only appears when a
              single pick actually lands the deal near even. */}
          <div
            style={{
              marginTop: 14,
              padding: "11px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgb(var(--accent-rgb) / .22)",
              background: "rgb(var(--surface-rgb) / .5)",
            }}
          >
            <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
              {verdict(gap, !empty, managerName.get(partner) ?? "they")}
            </div>

            {sweetener ? (
              <button
                type="button"
                onClick={() =>
                  sweetener.side === "send"
                    ? setGivePicks([...givePicks, sweetener.id])
                    : setGetPicks([...getPicks, sweetener.id])
                }
                style={{
                  cursor: "pointer",
                  width: "100%",
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 11px",
                  borderRadius: "var(--radius-sm)",
                  textAlign: "left",
                  font: "inherit",
                  minHeight: 34,
                  border: "1px dashed rgb(var(--good-rgb) / .5)",
                  background: "rgb(var(--good-rgb) / .08)",
                  color: "var(--good)",
                }}
              >
                <span style={{ fontSize: 10, letterSpacing: ".14em", flex: "0 0 auto" }}>EVEN IT</span>
                <span style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text-2)", minWidth: 0 }}>
                  {sweetener.text}
                </span>
              </button>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              rowGap: 8,
              flexWrap: "wrap",
              marginTop: 16,
            }}
          >
            <button
              onClick={send}
              disabled={busy || !partner || empty}
              className="btn btn-primary"
              style={{
                flex: "0 0 auto",
                padding: "9px 16px",
                border: "1px solid rgb(var(--accent-bright-rgb) / .6)",
                background: "transparent",
                color: "var(--accent-text)",
                borderRadius: "var(--radius-sm)",
                // The shorthand, deliberately: this button sets no size of its
                // own, so inheriting the body's is exactly what it wants. The
                // shorthand is only wrong where it lands under a fontSize.
                font: "inherit",
                cursor: busy ? "default" : "pointer",
                opacity: !partner || empty ? 0.45 : 1,
              }}
            >
              Send offer
            </button>
            <span style={{ flex: "1 1 200px", fontSize: 11, color: "var(--text-dim)" }}>
              Points scored this season, not a valuation — judge the deal yourself.
            </span>
          </div>
        </div>

        <div style={{ ...card, padding: "16px 18px" }}>
          <h6 style={{ margin: "0 0 10px", color: "var(--accent-text)" }}>Offers</h6>
          {desk.trades.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Nothing on the table.</div>
          ) : null}

          {desk.trades.map((t) => {
            const other = t.incoming ? t.from_manager : t.to_manager;
            // Picks are named the same way in the history as in the builder,
            // so a deal for two firsts does not read as an empty trade.
            const minePicks = t.incoming ? t.offer.getPicks : t.offer.givePicks;
            const theirPicks = t.incoming ? t.offer.givePicks : t.offer.getPicks;

            const mine = [...(t.incoming ? t.offer.get : t.offer.give), ...namePicks(minePicks)];
            const theirs = [...(t.incoming ? t.offer.give : t.offer.get), ...namePicks(theirPicks)];

            return (
              <div
                key={t.id}
                style={{ padding: "10px 0", borderTop: "1px solid rgb(var(--accent-rgb) / .14)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 13 }}>
                    {managerName.get(other) ?? "Unknown"}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: ".14em",
                      padding: "2px 6px",
                      borderRadius: 2,
                      border: `1px solid ${STATUS_COLOR[t.status]}66`,
                      color: STATUS_COLOR[t.status],
                    }}
                  >
                    {t.status.toUpperCase()}
                  </span>
                </div>

                <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 2px" }}>
                  You send: {mine.length ? mine.join(", ") : "nothing"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  You get: {theirs.length ? theirs.join(", ") : "nothing"}
                </div>

                {t.awaitingMe &&
                t.status !== "executed" &&
                t.status !== "declined" &&
                t.status !== "rescinded" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => respond(t, "accept")} disabled={busy} style={smallButton("var(--good)")}>
                      Accept
                    </button>
                    <button onClick={() => respond(t, "decline")} disabled={busy} style={smallButton("var(--warn)")}>
                      Decline
                    </button>
                  </div>
                ) : t.canRescind ? (
                  /* Waiting on them, so it is still yours to take back. */
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => respond(t, "rescind")}
                      disabled={busy}
                      style={smallButton("var(--warn)")}
                    >
                      Withdraw
                    </button>
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                      Waiting on the other manager.
                    </span>
                  </div>
                ) : t.status === "agreed" ? (
                  <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Waiting on the other manager.</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function rowButton(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "7px 9px",
    marginBottom: 4,
    border: `1px solid ${active ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .2)"}`,
    borderRadius: "var(--radius-sm)",
    background: active ? "rgb(var(--accent-rgb) / .22)" : "rgb(var(--sunken-rgb) / .5)",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
  };
}

function smallButton(color: string): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 10,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    border: `1px solid ${color}66`,
    background: "transparent",
    color,
    borderRadius: "var(--radius-sm)",
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
