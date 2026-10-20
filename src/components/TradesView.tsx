"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { player, proj } from "@/lib/roster";
import { useScoring } from "@/lib/use-me";
import { balancer, fitScore, pickValue, verdict, type Held } from "@/lib/moves-story";
import { useLogos } from "@/lib/use-logos";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import TeamCrest from "./TeamCrest";
import PlayerFace from "./PlayerFace";
import { AppView, Chips, GroupSkeleton, Note, RowGroup, heroPanel, ink, optStyle, wideBtnStyle, type RowSpec } from "./RowList";

interface Manager {
  id: string;
  slot: string;
  franchise: string;
}

interface Pick {
  id: string;
  season: number;
  round: number;
  slot: number | null;
  manager_id: string;
  origin_manager: string;
  tradeable: boolean;
}

interface Trade {
  id: string;
  from_manager: string;
  to_manager: string;
  offer: { give: string[]; get: string[]; givePicks?: string[]; getPicks?: string[] };
  status: "open" | "countered" | "agreed" | "voting" | "executed" | "declined" | "rescinded";
  created_at: string;
  incoming: boolean;
  awaitingMe: boolean;
  canRescind: boolean;
  vetoes: number;
  approvals: number;
  voteBar: number;
  closesAt: string | null;
}

/** A deal between two other managers that the league has a say on. */
interface LeagueTrade {
  id: string;
  from_manager: string;
  to_manager: string;
  offer: Trade["offer"];
  status: "voting" | "agreed";
  created_at: string;
  vetoes: number;
  approvals: number;
  voteBar: number;
  closesAt: string | null;
  myVote: "veto" | "approve" | null;
}

interface Desk {
  starters?: Record<string, number>;
  me: Manager & { league_id: string; is_commissioner?: boolean };
  managers: Manager[];
  picks: Pick[];
  trades: Trade[];
  league?: LeagueTrade[];
}

const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const ordinal = (n: number) => ORD[n] ?? `${n}th`;
const LIVE: Trade["status"][] = ["open", "countered", "agreed", "voting"];

async function fetchRoster(managerId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/rosters?manager=${encodeURIComponent(managerId)}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.players) ? body.players : [];
  } catch {
    return [];
  }
}

/** "closes in 14h", for a deal out for the league's vote. */
function closes(iso: string | null) {
  if (!iso) return "";
  const h = (Date.parse(iso) - Date.now()) / 3_600_000;
  if (!Number.isFinite(h)) return "";
  if (h <= 0) return "closing now";
  return h >= 24 ? `closes in ${Math.round(h / 24)}d` : h >= 1 ? `closes in ${Math.floor(h)}h` : "closes within the hour";
}

function ago(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}M`;
  if (h < 24) return `${Math.round(h)}H`;
  return `${Math.round(h / 24)}D`;
}

/**
 * General Manager → Trades: pick a partner (the best positional fit is marked
 * ◆ and sorted first), tick players and 2027 picks on either side, and the
 * balance up top totals both sides live with a verdict that turns over as the
 * deal does — and, when a single pick would bring a lopsided deal near even,
 * offers it in one tap. Offers on the table sit between, with Accept, Counter
 * and Decline, or Withdraw on your own. Value is points scored this season; a
 * pick is its round and where the standings place it. From the Trades view in
 * prototype/Pylon App.dc.html.
 *
 * ?with=, ?want= and ?give= still arrive from a player's sheet.
 */
export default function TradesView() {
  return (
    <Suspense
      fallback={
        <AppView>
          <GroupSkeleton rows={3} label={false} />
        </AppView>
      }
    >
      <Desk_ />
    </Suspense>
  );
}

function Desk_() {
  const scoring = useScoring();
  const logos = useLogos();
  const params = useSearchParams();
  const askedFor = params.get("want");
  const askedFrom = params.get("with");
  const askedToGive = params.get("give");

  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [partner, setPartner] = useState("");
  const [give, setGive] = useState<string[]>([]);
  const [want, setWant] = useState<string[]>([]);
  const [givePicks, setGivePicks] = useState<string[]>([]);
  const [getPicks, setGetPicks] = useState<string[]>([]);
  const [myRoster, setMyRoster] = useState<string[]>([]);
  const [theirRoster, setTheirRoster] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // What the last move on a trade did, shown beside that trade.
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null);
  // Forcing a trade cannot be undone, so it takes two presses.
  const [armed, setArmed] = useState<string | null>(null);
  const [countering, setCountering] = useState<{ id: string; franchise: string } | null>(null);
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

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const id = desk?.me.id;
    if (!id) return;
    let live = true;
    void fetchRoster(id).then((p) => live && setMyRoster(p));
    return () => {
      live = false;
    };
  }, [desk?.me.id]);

  // Arriving from a player's sheet: the partner, and who was asked for.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !desk) return;
    if (!askedFrom && !askedFor && !askedToGive) return;
    arrived.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (askedFrom && desk.managers.some((m) => m.id === askedFrom)) setPartner(askedFrom);
    if (askedToGive) setGive([askedToGive]);
  }, [desk, askedFrom, askedFor, askedToGive]);

  const took = useRef(false);
  useEffect(() => {
    if (took.current || !askedFor || !theirRoster.includes(askedFor)) return;
    took.current = true;
     
    setWant([askedFor]);
  }, [theirRoster, askedFor]);

  const partners = useMemo(() => (desk ? desk.managers.filter((m) => m.id !== desk.me.id) : []), [desk]);

  // With nobody asked for, the best fit is the one opened on.
  const rostersOf = useCallback(
    (franchise: string): Held[] =>
      Object.keys(rostered)
        .filter((n) => rostered[n] === franchise)
        .map((n) => ({ name: n, pos: player(n)?.p ?? "", points: totals[n]?.total ?? 0, games: totals[n]?.games ?? 0 })),
    [rostered, totals],
  );
  const starters = useMemo(
    () => (desk?.starters && Object.keys(desk.starters).length ? desk.starters : { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, "D/ST": 1 }),
    [desk],
  );
  const fits = useMemo(() => {
    if (!desk) return new Map<string, number>();
    const mine = rostersOf(desk.me.franchise);
    return new Map(partners.map((m) => [m.id, fitScore(mine, rostersOf(m.franchise), starters)]));
  }, [desk, partners, rostersOf, starters]);
  const ordered = useMemo(
    () => partners.slice().sort((a, b) => (fits.get(b.id) ?? 0) - (fits.get(a.id) ?? 0) || a.franchise.localeCompare(b.franchise)),
    [partners, fits],
  );
  const active = partner || (!askedFrom ? (ordered[0]?.id ?? "") : "");

  useEffect(() => {
    if (!active) return;
    let live = true;
    void fetchRoster(active).then((p) => live && setTheirRoster(p));
    return () => {
      live = false;
    };
  }, [active]);

  const worth = useCallback(
    (name: string) => {
      const row = totals[name];
      return row && row.games > 0 ? row.total : proj(name, scoring);
    },
    [totals, scoring],
  );

  if (error && !desk) {
    return (
      <AppView>
        <Note tag="TRADES" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!desk) {
    return (
      <AppView>
        <GroupSkeleton rows={3} label={false} />
        <GroupSkeleton rows={6} />
      </AppView>
    );
  }

  const franchiseOf = (id: string) => desk.managers.find((m) => m.id === id)?.franchise ?? "";
  const teams = desk.managers.length || 12;
  const pickWorth = (id: string) => {
    const p = desk.picks.find((x) => x.id === id);
    return p ? pickValue(p.round, p.slot ?? 6, teams) : 0;
  };
  const pickLabel = (p: Pick) =>
    `${p.season} ${ordinal(p.round)}${p.origin_manager === p.manager_id ? "" : ` (${franchiseOf(p.origin_manager)})`}${p.slot ? ` · pick ${p.slot}` : ""}`;
  const namePicks = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => {
      const p = desk.picks.find((x) => x.id === id);
      return p ? `${p.season} ${ordinal(p.round)}` : "a pick";
    });

  const sendValue = give.reduce((s, n) => s + worth(n), 0) + givePicks.reduce((s, id) => s + pickWorth(id), 0);
  const getValue = want.reduce((s, n) => s + worth(n), 0) + getPicks.reduce((s, id) => s + pickWorth(id), 0);
  const gap = getValue - sendValue;
  const anything = give.length + want.length + givePicks.length + getPicks.length > 0;
  const who = franchiseOf(active) || "they";
  const topFit = Math.max(0, ...fits.values());

  const sweetener = active
    ? balancer(
        gap,
        desk.picks
          .filter((p) => p.tradeable)
          .filter((p) => (gap > 0 ? p.manager_id === desk.me.id && !givePicks.includes(p.id) : p.manager_id === active && !getPicks.includes(p.id)))
          .map((p) => ({ id: p.id, label: `${p.season} ${ordinal(p.round)}`, value: pickValue(p.round, p.slot ?? 6, teams) })),
        who,
      )
    : null;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function clearBuilder() {
    setGive([]);
    setWant([]);
    setGivePicks([]);
    setGetPicks([]);
    setCountering(null);
  }

  async function send() {
    if (!active || !anything || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = countering
        ? await fetch(`/api/trades/${countering.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "counter", give, get: want, givePicks, getPicks }),
          })
        : await fetch("/api/trades", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: active, give, get: want, givePicks, getPicks }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? (countering ? "Counter was not sent." : "Offer was not sent."));
      else {
        setNotice(countering ? `Counter sent to ${countering.franchise}.` : `Offer sent to ${who}.`);
        clearBuilder();
        setError(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function respond(t: { id: string }, action: "accept" | "decline" | "rescind" | "force") {
    setBusy(true);
    try {
      const res = await fetch(`/api/trades/${t.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      const text = res.ok ? null : (body.error ?? "That did not go through.");
      setError(text);
      // Said beside the trade too: the page's own note is a screen away.
      setSaid(text ? { id: t.id, text } : action === "force" ? { id: t.id, text: "Forced through. The trade is done." } : null);
      setArmed(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function vote(t: LeagueTrade, how: "veto" | "approve") {
    setBusy(true);
    try {
      const res = await fetch(`/api/trades/${t.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote: how }),
      });
      const body = await res.json().catch(() => ({}));
      setSaid({ id: t.id, text: res.ok ? (how === "veto" ? "You voted to veto." : "You voted to approve.") : (body.error ?? "Your vote did not go through.") });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function startCounter(t: Trade) {
    const other = t.incoming ? t.from_manager : t.to_manager;
    setPartner(other);
    setGive(t.incoming ? t.offer.get : t.offer.give);
    setWant(t.incoming ? t.offer.give : t.offer.get);
    setGivePicks((t.incoming ? t.offer.getPicks : t.offer.givePicks) ?? []);
    setGetPicks((t.incoming ? t.offer.givePicks : t.offer.getPicks) ?? []);
    setCountering({ id: t.id, franchise: franchiseOf(other) || "them" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // One side of a deal, opened: every player and pick with what each is worth.
  const side = (label: string, names: string[], pickIds: string[], total: number) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".14em", color: "var(--ap-n500)", marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{total.toFixed(1)}</span>
      </div>
      {names.length + pickIds.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--ap-n500)", padding: "4px 0" }}>Nothing</div>
      ) : null}
      {names.map((n) => {
        const p = player(n);
        return (
          <button
            key={n}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openPlayer(n);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", border: 0, borderTop: `1px solid ${ink(6)}`, background: "transparent", padding: "4px 0", font: "inherit", color: "inherit", cursor: "pointer" }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n}</span>
              <span style={{ display: "block", fontSize: 10, color: "var(--ap-n500)" }}>{[p?.p, p?.t].filter(Boolean).join(" · ") || "—"}</span>
            </span>
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--ap-n300)" }}>{worth(n).toFixed(1)}</span>
          </button>
        );
      })}
      {pickIds.map((id) => {
        const pk = desk.picks.find((x) => x.id === id);
        return (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${ink(6)}`, padding: "6px 0", minHeight: 40, boxSizing: "border-box" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12 }}>{pk ? pickLabel(pk) : "A draft pick"}</span>
              <span style={{ display: "block", fontSize: 10, color: "var(--ap-n500)" }}>Draft pick</span>
            </span>
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--ap-n300)" }}>{pickWorth(id).toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
  const offers: RowSpec[] = desk.trades
    .filter((t) => LIVE.includes(t.status))
    .map((t) => {
      const other = t.incoming ? t.from_manager : t.to_manager;
      const them = franchiseOf(other) || "them";
      // Their side and yours, from where the reader sits.
      const getNames = t.incoming ? t.offer.give : t.offer.get;
      const giveNames = t.incoming ? t.offer.get : t.offer.give;
      const getPickIds = (t.incoming ? t.offer.givePicks : t.offer.getPicks) ?? [];
      const givePickIds = (t.incoming ? t.offer.getPicks : t.offer.givePicks) ?? [];
      const mine = [...giveNames, ...namePicks(givePickIds)];
      const theirs = [...getNames, ...namePicks(getPickIds)];
      const gv = getNames.reduce((s, n) => s + worth(n), 0) + getPickIds.reduce((s, id) => s + pickWorth(id), 0);
      const sv = giveNames.reduce((s, n) => s + worth(n), 0) + givePickIds.reduce((s, id) => s + pickWorth(id), 0);
      const d = gv - sv;
      const open = t.awaitingMe && LIVE.includes(t.status) && t.status !== "voting";
      const actions = open
        ? // Counter and decline are spelled out once the offer is opened.
          [{ label: "ACCEPT", disabled: busy, onClick: () => void respond(t, "accept") }]
        : t.canRescind
          ? [{ label: "WITHDRAW", tone: "quiet" as const, disabled: busy, onClick: () => void respond(t, "rescind") }]
          : [];
      const status =
        t.status === "voting"
          ? `with the league · ${t.vetoes}/${t.voteBar} veto · ${t.approvals}/${t.voteBar} approve`
          : t.status === "agreed"
            ? "agreed · waiting on approval"
            : t.awaitingMe
              ? "waiting on you"
              : "waiting on them";

      // Opened, the whole deal: every player and pick with what each is
      // worth, the totals and the verdict, where it stands, and the same
      // moves as the row's buttons spelled out in words.
      const when = new Date(t.created_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const closes = t.closesAt
        ? new Date(t.closesAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
        : null;
      const moves = open
        ? [
            { label: "ACCEPT", onClick: () => void respond(t, "accept") },
            { label: "COUNTER", tone: "quiet" as const, onClick: () => startCounter(t) },
            { label: "DECLINE", tone: "danger" as const, onClick: () => void respond(t, "decline") },
          ]
        : actions.map((a) => ({ label: a.label, tone: "tone" in a ? a.tone : undefined, onClick: a.onClick }));
      const extra = (
        <div style={{ padding: "0 12px 12px 46px" }} data-offer-detail>
          {side("YOU GET", getNames, getPickIds, gv)}
          {side("YOU GIVE", giveNames, givePickIds, sv)}
          <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ap-n300)", marginTop: 10 }}>{verdict(d, true, them)}</div>
          <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ap-n500)", marginTop: 6 }}>
            {t.incoming ? `Sent to you by ${them}` : `You sent this to ${them}`} · {when}
            {t.status === "voting"
              ? ` · League vote: ${t.vetoes} of ${t.voteBar} vetoes, ${t.approvals} of ${t.voteBar} approvals${closes ? ` · closes ${closes}` : ""}`
              : t.status === "agreed"
                ? " · Both sides agreed; waiting on approval"
                : ""}
          </div>
          {moves.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {moves.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className="gl-press"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    m.onClick();
                  }}
                  style={optStyle(m.tone)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );

      return {
        key: t.id,
        logo: <TeamCrest franchise={them} logo={logos[other] ?? null} size={26} shape="box" />,
        title: `Get ${theirs.length ? theirs.join(", ") : "nothing"}`,
        sub: `Give ${mine.length ? mine.join(", ") : "nothing"} · ${them} · ${status} · ${ago(t.created_at)}`,
        tags: [{ label: `${d >= 0 ? "+" : ""}${d.toFixed(1)}`, tone: d >= 0 ? ("slot" as const) : ("flat" as const) }],
        actions,
        extra,
      };
    });

  const leagueRows: RowSpec[] = (desk.league ?? []).map((t) => {
    const from = franchiseOf(t.from_manager) || "One side";
    const to = franchiseOf(t.to_manager) || "the other";
    const fromGives = t.offer.give ?? [];
    const toGives = t.offer.get ?? [];
    const fromPicks = t.offer.givePicks ?? [];
    const toPicks = t.offer.getPicks ?? [];
    const fv = fromGives.reduce((s, n) => s + worth(n), 0) + fromPicks.reduce((s, id) => s + pickWorth(id), 0);
    const tv = toGives.reduce((s, n) => s + worth(n), 0) + toPicks.reduce((s, id) => s + pickWorth(id), 0);
    const voting = t.status === "voting";
    const status = voting
      ? [`${t.vetoes}/${t.voteBar} veto`, `${t.approvals}/${t.voteBar} approve`, closes(t.closesAt)].filter(Boolean).join(" · ")
      : "agreed · waiting on approval";
    const canVote = voting && !t.myVote;
    const moves: { label: string; tone?: "danger" | "warn" | "quiet"; onClick: () => void }[] = [];
    if (canVote) {
      moves.push({ label: "APPROVE", onClick: () => void vote(t, "approve") });
      moves.push({ label: "VETO", tone: "danger", onClick: () => void vote(t, "veto") });
    }
    if (desk.me.is_commissioner) {
      moves.push(
        armed === t.id
          ? { label: "CONFIRM FORCE", tone: "warn", onClick: () => void respond(t, "force") }
          : { label: "FORCE THROUGH", tone: "quiet", onClick: () => setArmed(t.id) },
      );
    }
    return {
      key: `league:${t.id}`,
      logo: <TeamCrest franchise={from} logo={logos[t.from_manager] ?? null} size={26} shape="box" />,
      title: `${from} ⇄ ${to}`,
      tags: t.myVote ? [{ label: t.myVote === "veto" ? "YOU VETOED" : "YOU APPROVED", tone: "flat" as const }] : canVote ? [{ label: "YOUR VOTE", tone: "warn" as const }] : [],
      sub: status,
      extra: (
        <div style={{ padding: "0 12px 12px 46px" }} data-league-trade>
          {side(`${from.toUpperCase()} SENDS`, fromGives, fromPicks, fv)}
          {side(`${to.toUpperCase()} SENDS`, toGives, toPicks, tv)}
          <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ap-n500)", marginTop: 8 }}>
            {voting
              ? `Out for the league's vote: ${t.voteBar} vetoes stop it, and it goes through when the window closes without them.`
              : "Both sides have agreed; it is waiting on approval."}
            {armed === t.id ? " Forcing it through skips the vote and cannot be undone." : ""}
          </div>
          {said?.id === t.id ? <div role="status" style={{ fontSize: 11, color: "var(--ap-n300)", marginTop: 8 }}>{said.text}</div> : null}
          {moves.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {moves.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className="gl-press"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    m.onClick();
                  }}
                  style={optStyle(m.tone)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ),
    };
  });

  const pick = (key: "send" | "get") => (name: string): RowSpec => {
    const list = key === "send" ? give : want;
    const set = key === "send" ? setGive : setWant;
    const p = player(name);
    return {
      key: `${key}:${name}`,
      logo: <PlayerFace name={name} size={26} />,
      check: list.includes(name),
      title: name,
      sub: [p?.p, p?.t].filter(Boolean).join(" · "),
      val: worth(name).toFixed(1),
      tight: true,
      onClick: () => toggle(list, set, name),
    };
  };
  const pickRow = (key: "send" | "get") => (p: Pick): RowSpec => {
    const list = key === "send" ? givePicks : getPicks;
    const set = key === "send" ? setGivePicks : setGetPicks;
    return {
      key: `${key}:p:${p.id}`,
      check: list.includes(p.id),
      title: pickLabel(p),
      sub: "Draft pick",
      val: pickValue(p.round, p.slot ?? 6, teams).toFixed(1),
      tight: true,
      onClick: () => toggle(list, set, p.id),
    };
  };
  const byWorth = (a: string, b: string) => worth(b) - worth(a);

  return (
    <AppView>
      <Chips
        label="Trade partner"
        value={active}
        onChange={(v) => {
          setPartner(v);
          setWant([]);
          setGetPicks([]);
          setCountering(null);
        }}
        options={ordered.map((m) => ({ value: m.id, label: `${m.franchise}${topFit > 0 && fits.get(m.id) === topFit ? " ◆" : ""}` }))}
      />
      {countering ? (
        <Note tag="COUNTER">
          Answering {countering.franchise}&apos;s offer.{" "}
          <button type="button" onClick={clearBuilder} style={{ border: 0, background: "none", padding: 0, color: "var(--ap-a300)", font: "inherit", cursor: "pointer" }}>
            Start over
          </button>
        </Note>
      ) : null}
      {notice ? <Note tag="SENT">{notice}</Note> : null}
      {error ? <Note tag="ERROR" tone="warn">{error}</Note> : null}

      <div style={{ ...heroPanel, padding: "10px 12px", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: ".16em", color: "var(--ap-n500)" }}>YOU SEND</div>
            <div style={{ fontSize: 20, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", color: "var(--ap-a200)", marginTop: 4 }}>
              {sendValue.toFixed(1)}
            </div>
          </div>
          <span aria-hidden style={{ margin: "0 auto", color: "var(--ap-n600)" }}>
            ⇄
          </span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, letterSpacing: ".16em", color: "var(--ap-n500)" }}>YOU GET</div>
            <div style={{ fontSize: 20, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", marginTop: 4 }}>{getValue.toFixed(1)}</div>
          </div>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: ink(10), overflow: "hidden", marginTop: 10 }}>
          <div
            style={{
              height: "100%",
              transition: "width .4s ease",
              background: "linear-gradient(90deg,var(--ap-a600),var(--ap-a200))",
              width: `${anything ? Math.round((getValue / (getValue + sendValue || 1)) * 100) : 50}%`,
            }}
          />
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ap-n300)", marginTop: 9 }}>{verdict(gap, anything, who)}</div>
        {sweetener ? (
          <button
            type="button"
            className="gl-press"
            onClick={() => (sweetener.side === "send" ? setGivePicks((l) => [...l, sweetener.id]) : setGetPicks((l) => [...l, sweetener.id]))}
            style={{ ...optStyle(), width: "100%", marginTop: 8 }}
          >
            + {sweetener.text.toUpperCase()}
          </button>
        ) : null}
        <button
          type="button"
          className="gl-press"
          disabled={!anything || !active || busy}
          onClick={() => void send()}
          style={{ ...wideBtnStyle(anything && !!active && !busy), marginTop: 10 }}
        >
          {busy ? "SENDING…" : !anything ? "SELECT PLAYERS" : countering ? `SEND COUNTER TO ${countering.franchise.toUpperCase()}` : `SEND TO ${who.toUpperCase()}`}
        </button>
      </div>

      {leagueRows.length ? (
        <RowGroup
          label="LEAGUE VOTES"
          note={`${leagueRows.length} open · tap one for the details`}
          rows={leagueRows}
        />
      ) : null}
      <RowGroup
        label="CURRENT OFFERS"
        note={offers.length ? `${offers.length} open · tap one for the details` : "0 open"}
        rows={offers}
        empty={{ title: "No open offers", sub: "Accepted and declined offers move to Transactions." }}
      />
      <RowGroup
        label="YOU SEND"
        rows={[
          ...myRoster.slice().sort(byWorth).map(pick("send")),
          ...desk.picks.filter((p) => p.tradeable && p.manager_id === desk.me.id).map(pickRow("send")),
        ]}
        limit={6}
      />
      {active ? (
        <RowGroup
          label={`${who.toUpperCase()} SENDS`}
          rows={[
            ...theirRoster.slice().sort(byWorth).map(pick("get")),
            ...desk.picks.filter((p) => p.tradeable && p.manager_id === active).map(pickRow("get")),
          ]}
          limit={6}
        />
      ) : null}
    </AppView>
  );
}
