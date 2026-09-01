"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { logo } from "@/data/league-data";
import { player, proj } from "@/lib/roster";

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
  me: Manager & { league_id: string };
  managers: Manager[];
  block: { player_name: string; manager_id: string }[];
  picks: Pick[];
  inauguralSeason: number | null;
  trades: Trade[];
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

function ordinal(n: number): string {
  return ORDINAL[n] ?? `${n}th`;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
};

const STATUS_COLOR: Record<Trade["status"], string> = {
  open: "#b5abfc",
  countered: "#e0b573",
  agreed: "#7fd1a8",
  executed: "#7fd1a8",
  declined: "#75798c",
  rescinded: "#75798c",
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
    <div style={{ marginTop: 12, borderTop: "1px solid rgba(145,132,217,.16)", paddingTop: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 7 }}>
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
              <span style={{ marginLeft: "auto", color: "#75798c", fontSize: 10 }}>LOCKED</span>
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
        border: "1px solid rgba(145,132,217,.3)",
        borderRadius: "var(--radius-sm)",
        background: "rgba(20,22,35,.7)",
        fontSize: 12,
      }}
    >
      {p?.t ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo(p.t)} alt="" width={14} height={14} style={{ objectFit: "contain" }} />
      ) : null}
      {name}
      <span style={{ color: "#75798c", fontSize: 10 }}>{proj(name).toFixed(1)}</span>
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          style={{
            border: "none",
            background: "none",
            color: "#75798c",
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

  const giveValue = give.reduce((s, n) => s + proj(n), 0);
  const wantValue = want.reduce((s, n) => s + proj(n), 0);

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
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!desk) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Opening the trade desk…</div>;
  }

  const partners = desk.managers.filter((m) => m.id !== desk.me.id);

  return (
    <>
      <div style={{ padding: "24px 26px 12px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>TRADE DESK</div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 44,
            lineHeight: 1.04,
            letterSpacing: "-.035em",
            margin: "8px 0 0",
          }}
        >
          {desk.me.franchise}
        </div>
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
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
          <h6 style={{ margin: "0 0 10px", color: "#d2cefd" }}>Build an offer</h6>

          <label style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c" }}>
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
              background: "rgba(20,22,35,.8)",
              color: "#e9e9ed",
              border: "1px solid rgba(145,132,217,.3)",
              borderRadius: "var(--radius-sm)",
              font: "inherit",
            }}
          >
            <option value="">Pick a manager…</option>
            {partners.map((m) => (
              <option key={m.id} value={m.id}>
                {m.franchise}
              </option>
            ))}
          </select>

          {/* The two sides sit side by side so a manager reads the deal as one
              exchange rather than two lists. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 8 }}>
                YOU SEND · {giveValue.toFixed(1)}
              </div>
              <div style={{ minHeight: 34, marginBottom: 8 }}>
                {give.map((n) => (
                  <PlayerChip key={n} name={n} onRemove={() => toggle(give, setGive, n)} />
                ))}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {myRoster.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggle(give, setGive, n)}
                    style={rowButton(give.includes(n))}
                  >
                    {n}
                    <span style={{ marginLeft: "auto", color: "#75798c", fontSize: 11 }}>
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
              <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 8 }}>
                YOU GET · {wantValue.toFixed(1)}
              </div>
              <div style={{ minHeight: 34, marginBottom: 8 }}>
                {want.map((n) => (
                  <PlayerChip key={n} name={n} onRemove={() => toggle(want, setWant, n)} />
                ))}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {!partner ? (
                  <div style={{ fontSize: 11, color: "#75798c" }}>Pick a manager first.</div>
                ) : null}
                {theirRoster.map((n) => (
                  <button
                    key={n}
                    onClick={() => toggle(want, setWant, n)}
                    style={rowButton(want.includes(n))}
                  >
                    {n}
                    <span style={{ marginLeft: "auto", color: "#75798c", fontSize: 11 }}>
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

          <button
            onClick={send}
            disabled={busy || !partner || empty}
            className="btn btn-primary"
            style={{
              marginTop: 16,
              padding: "9px 16px",
              border: "1px solid rgba(181,171,252,.6)",
              background: "transparent",
              color: "#d2cefd",
              borderRadius: "var(--radius-sm)",
              font: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: !partner || empty ? 0.45 : 1,
            }}
          >
            Send offer
          </button>
          <span style={{ marginLeft: 12, fontSize: 11, color: "#75798c" }}>
            Projected points, not a valuation — judge the deal yourself.
          </span>
        </div>

        <div style={{ ...card, padding: "16px 18px" }}>
          <h6 style={{ margin: "0 0 10px", color: "#d2cefd" }}>Offers</h6>
          {desk.trades.length === 0 ? (
            <div style={{ fontSize: 11, color: "#75798c" }}>Nothing on the table.</div>
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
                style={{ padding: "10px 0", borderTop: "1px solid rgba(145,132,217,.14)" }}
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

                <div style={{ fontSize: 11, color: "#9397ab", margin: "6px 0 2px" }}>
                  You send: {mine.length ? mine.join(", ") : "nothing"}
                </div>
                <div style={{ fontSize: 11, color: "#9397ab", marginBottom: 6 }}>
                  You get: {theirs.length ? theirs.join(", ") : "nothing"}
                </div>

                {t.awaitingMe &&
                t.status !== "executed" &&
                t.status !== "declined" &&
                t.status !== "rescinded" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => respond(t, "accept")} disabled={busy} style={smallButton("#7fd1a8")}>
                      Accept
                    </button>
                    <button onClick={() => respond(t, "decline")} disabled={busy} style={smallButton("#e0b573")}>
                      Decline
                    </button>
                  </div>
                ) : t.canRescind ? (
                  /* Waiting on them, so it is still yours to take back. */
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => respond(t, "rescind")}
                      disabled={busy}
                      style={smallButton("#e0b573")}
                    >
                      Withdraw
                    </button>
                    <span style={{ fontSize: 10, color: "#75798c" }}>
                      Waiting on the other manager.
                    </span>
                  </div>
                ) : t.status === "agreed" ? (
                  <div style={{ fontSize: 10, color: "#75798c" }}>Waiting on the other manager.</div>
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
    border: `1px solid ${active ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.2)"}`,
    borderRadius: "var(--radius-sm)",
    background: active ? "rgba(145,132,217,.22)" : "rgba(20,22,35,.5)",
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
    font: "inherit",
    cursor: "pointer",
  };
}
