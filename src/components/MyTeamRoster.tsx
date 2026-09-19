"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "./Skeleton";
import PlayerName from "./PlayerName";
import { useRefreshable } from "@/lib/use-refresh";
import { flagColor, flagsFor, player, proj, type LeagueShape } from "@/lib/roster";
import { optimalLineup } from "@/lib/start-rate";
import { fieldedAt, positionForm, tierOf, type Scored } from "@/lib/position-form";
import { ROLES } from "@/data/league-data";

/** How often a page left open on a Sunday goes and asks for the numbers. */
const POLL_MS = 60_000;

/**
 * The roster, grouped by what a man plays.
 *
 * The lineup page splits this into starters and bench, which is the right
 * split in a league where somebody chooses. Here nobody does — best ball fills
 * the slots from whoever actually scores — so a bench is a fiction, and
 * sorting by it hides the question a manager does have: how many receivers is
 * too many.
 *
 * By position, then, with two numbers per man that answer different things.
 * The projection says what he is worth this week. The pair of chips under him
 * say what he is: where he ranks at his position across the whole pool, and
 * what he has actually been worth per week.
 *
 * Those two replaced a start rate — how often he made this roster's own lineup
 * across four hundred simulated weeks. It was a good number about the wrong
 * thing. "Fourth receiver on your team" is a fact about the team; a manager
 * deciding whether to keep somebody, trade him, or drop him for a waiver claim
 * is asking about the player, and the answer to that is WR14 at 13.8 a week.
 *
 * The slot chip still marks the arrangement projection alone would pick today.
 */

const ORDER = ["QB", "RB", "WR", "TE", "K", "D/ST"] as const;

interface Feed {
  settings: LeagueShape | null;
  mine?: boolean;
  roster: string[];
  injuredReserve: string[];
  started: boolean;
  scores: Record<string, { points: number; statLine: string }>;
  /** Who the injury report says may sit outside the eighteen. */
  irEligible?: Record<string, boolean>;
  /** Stashed players it says are fit again — the ones now on the books. */
  irReturns?: string[];
  irLimit?: number;
  rosterCount?: number;
  rosterLimit?: number;
}

/** What /api/rankings answers: the league's scored pool, and who holds whom. */
interface Pool {
  points?: Record<string, { total: number; games: number }>;
  /** How many franchises there are, which is what turns a rank into a tier. */
  teams?: number;
}

const MICRO: React.CSSProperties = { fontSize: 10, letterSpacing: ".14em" };

/** What the league fields at this position, said in the group header. */
function startsLabel(pos: string, league: LeagueShape | null): string {
  const n = league?.starters?.[pos as keyof NonNullable<LeagueShape["starters"]>] ?? 0;
  if (!n) return "";
  return n === 1 ? "1 START" : `${n} START`;
}

export default function MyTeamRoster() {
  const [feed, setFeed] = useState<Feed | null>(null);
  /** The league's whole scored pool, which is what a position rank is against. */
  const [pool, setPool] = useState<Pool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The pool alongside the roster rather than after it: a rank drawn from a
    // table that arrives a beat later would flick from "—" to "WR14" on every
    // poll.
    void fetch("/api/rankings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setPool(body as Pool))
      .catch(() => {});

    try {
      const res = await fetch("/api/lineup", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your roster.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not load your roster.");
    }
  }, []);

  // Stashing somebody, or bringing him back. A round trip rather than an
  // optimistic move: the reserve has a size, the roster has a capacity, and
  // both are decided in the database.
  const stash = useCallback(
    async (name: string, ir: boolean) => {
      setBusy(name);
      setError(null);
      try {
        const res = await fetch("/api/lineup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player: name, ir }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof body.error === "string" ? body.error : "That did not work.");
          return;
        }
        await load();
      } catch {
        setError("That did not work.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Whether the league has written down a single number this week.
  //
  // Not the same as the week being flagged as begun: the flag turns over when
  // the first fixture is due, and the scores arrive when somebody actually
  // plays. In the hours between, every row on a full roster read 0.0 PTS,
  // which looks like a disaster rather than a Sunday morning.
  //
  // Whichever it is, it is the basis for the points and the slot chips alike,
  // so they never disagree about which week they are describing.
  const live = useMemo(
    () => Boolean(feed?.started) && (feed?.roster ?? []).some((n) => feed?.scores?.[n] != null),
    [feed],
  );

  const values = useMemo(() => {
    const out = new Map<string, number>();
    for (const name of feed?.roster ?? []) {
      out.set(name, live ? (feed?.scores?.[name]?.points ?? 0) : proj(name));
    }
    return out;
  }, [feed, live]);

  const slots = useMemo(
    () => (feed ? optimalLineup(feed.roster, feed.settings, values) : new Map<string, string>()),
    [feed, values],
  );

  // Where every scored player stands at his own position, and what he has been
  // worth a week. Across the whole pool, not this roster: "second-best back you
  // hold" is a fact about the roster, and the question a manager is asking is
  // about the player.
  const form = useMemo(() => {
    const scored: Scored[] = Object.entries(pool?.points ?? {}).map(([name, row]) => ({
      name,
      position: player(name)?.p ?? "",
      points: Number(row.total) || 0,
      games: Number(row.games) || 0,
    }));
    return positionForm(scored);
  }, [pool]);

  // What turns a rank into a tier: RB20 is a weekly starter in a twelve-team
  // league and unrostered in a six.
  const teams = pool?.teams ?? 0;

  const groups = useMemo(() => {
    if (!feed) return [];

    const out: { pos: string; players: string[] }[] = [];
    for (const pos of ORDER) {
      const held = feed.roster.filter((name) => player(name)?.p === pos);
      if (held.length) {
        out.push({
          pos,
          players: held.sort((a, b) => (values.get(b) ?? 0) - (values.get(a) ?? 0)),
        });
      }
    }

    // Anybody the pool cannot place still belongs on his own roster. Better a
    // group called "OTHER" than a man who silently vanishes from the screen he
    // was signed onto.
    const placed = new Set(out.flatMap((g) => g.players));
    const rest = feed.roster.filter((name) => !placed.has(name));
    if (rest.length) out.push({ pos: "OTHER", players: rest });

    if (feed.injuredReserve.length) out.push({ pos: "IR", players: feed.injuredReserve });
    return out;
  }, [feed, values]);

  if (error && !feed) {
    return <div style={{ padding: "0 18px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!feed) {
    return <Skeleton rows={6} />;
  }

  if (!feed.roster.length && !feed.injuredReserve.length) {
    // Nobody owns anybody before the draft runs, which is not an empty state
    // to apologise for — it is the state the whole league is in on day one.
    return (
      <div style={{ padding: "0 18px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
        Nothing here until the draft runs. Every franchise starts empty.
      </div>
    );
  }

  const mine = feed.mine !== false;
  const eligible = feed.irEligible ?? {};
  const returns = feed.irReturns ?? [];
  const irLimit = Number(feed.irLimit ?? feed.settings?.ir ?? 0);
  const over =
    feed.rosterCount != null && feed.rosterLimit != null && feed.rosterCount > feed.rosterLimit;

  return (
    <div style={{ padding: "0 18px" }}>
      {/* The one thing on this page that is a demand rather than a report. A
          stashed player the report has cleared is on the books where he sits,
          so a manager who was full is now over — and nothing else can be
          added until somebody goes. Named rather than merely counted: "your
          roster is wrong somewhere" is not something anybody can act on. */}
      {mine && returns.length ? (
        <div
          style={{
            border: `1px solid ${over ? "var(--warn)" : "rgb(var(--accent-rgb) / .3)"}`,
            borderRadius: "var(--radius-lg)",
            background: over ? "rgb(var(--warn-rgb) / .1)" : "rgb(var(--surface-rgb) / .55)",
            padding: "12px 14px",
            margin: "0 0 14px",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--text-2)",
          }}
        >
          <strong style={{ color: over ? "var(--warn)" : "var(--text)", fontWeight: 500 }}>
            {returns.length === 1
              ? `${returns[0]} is cleared to play.`
              : `${returns.join(", ")} are cleared to play.`}
          </strong>{" "}
          {over
            ? `The reserve only holds players who cannot play, so ${returns.length === 1 ? "he counts" : "they count"} against your ${feed.rosterLimit} again — you are at ${feed.rosterCount}. Drop somebody before you can add anybody.`
            : `The reserve only holds players who cannot play, so ${returns.length === 1 ? "he is" : "they are"} back on your ${feed.rosterLimit} — you have room.`}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            border: "1px solid var(--warn)",
            borderRadius: "var(--radius-lg)",
            padding: "12px 14px",
            margin: "0 0 14px",
            fontSize: 12.5,
            color: "var(--warn)",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Four lines to say two things, on a page a manager opens every week.
          The second half of it described the two chips under each name —
          which are labelled "QB2" and "26.2 PPG" and carry the long version
          in their titles, so the paragraph was explaining a thing that says
          itself. What is left is the one rule of the format that is not
          visible anywhere on the screen. */}
      <p
        style={{
          padding: "2px 0 12px",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--text-quiet)",
          margin: 0,
        }}
      >
        Best ball — the highest-scoring legal lineup is taken for you every week. The highlighted
        men are the ones it would take right now.
      </p>

      {groups.map((group) => {
        const ir = group.pos === "IR";
        const starts = ir ? "" : startsLabel(group.pos, feed.settings);

        return (
          <div key={group.pos} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 12,
                  letterSpacing: ".2em",
                  color: "var(--accent-link)",
                }}
              >
                {group.pos}
              </span>
              <span style={{ ...MICRO, color: "var(--text-dim)" }}>
                {group.players.length === 1 ? "1 PLAYER" : `${group.players.length} PLAYERS`}
              </span>
              {starts ? (
                <span style={{ ...MICRO, marginLeft: "auto", color: "var(--text-dim)" }}>
                  {starts}
                </span>
              ) : null}
            </div>

            <div
              style={{
                border: "1px solid rgb(var(--accent-rgb) / .2)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                background: "rgb(var(--surface-rgb) / .72)",
              }}
            >
              {group.players.map((name, i) => {
                const slot = slots.get(name) ?? null;
                const standing = form.get(name) ?? null;
                const p = player(name);
                const role = ROLES[name]?.role;
                const line = [p?.t, role].filter(Boolean).join(" · ");

                // Which way this row can move, if either. A stashed player
                // always offers the way back — including, and especially, one
                // the report has cleared, who is the whole reason the way back
                // has to be there. A rostered player is offered the reserve
                // only when he belongs in it and there is room.
                const irButton = !mine
                  ? null
                  : ir
                    ? "ACTIVATE"
                    : eligible[name] && irLimit > 0 && feed.injuredReserve.length < irLimit
                      ? "IR"
                      : null;

                return (
                  <div
                    key={name}
                    className="gl-mt-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "9px 13px",
                      borderTop: i ? "1px solid rgb(var(--accent-rgb) / .13)" : undefined,
                      background: slot ? "rgb(var(--accent-rgb) / .12)" : undefined,
                      boxShadow: slot ? "inset 2px 0 0 var(--accent-link)" : undefined,
                      opacity: ir ? 0.6 : undefined,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <PlayerName
                          name={name}
                          style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}
                        />

                        {slot ? (
                          <span
                            data-chip="slot"
                            style={{
                              ...MICRO,
                              flex: "0 0 auto",
                              letterSpacing: ".1em",
                              padding: "2px 6px",
                              borderRadius: 3,
                              border: "1px solid rgb(var(--accent-bright-rgb) / .7)",
                              background: "rgb(var(--accent-rgb) / .24)",
                              color: "var(--accent-text)",
                            }}
                          >
                            {slot}
                          </span>
                        ) : null}

                        {flagsFor(name).map((f) => (
                          <span
                            key={f.label}
                            style={{
                              ...MICRO,
                              flex: "0 0 auto",
                              letterSpacing: ".1em",
                              padding: "2px 5px",
                              borderRadius: 3,
                              border: `1px solid ${flagColor(f.kind)}66`,
                              color: flagColor(f.kind),
                            }}
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>

                      <FormChips
                        position={p?.p ?? ""}
                        standing={standing}
                        fielded={fieldedAt(p?.p ?? "", feed.settings?.starters, teams)}
                        out={ir}
                        lead={line}
                      />
                    </div>

                    {/* Offered only where the database will accept it: the
                        reserve is for players the injury report puts on IR or
                        under suspension, and it has a size. A button that
                        always refuses is worse than no button. */}
                    {irButton ? (
                      <button
                        type="button"
                        onClick={() => void stash(name, irButton === "IR")}
                        disabled={busy === name}
                        title={
                          irButton === "IR"
                            ? `Stash ${name} on injured reserve`
                            : `Bring ${name} back onto your roster`
                        }
                        style={{
                          cursor: busy === name ? "default" : "pointer",
                          flex: "0 0 auto",
                          fontFamily: "inherit",
                          fontSize: 10,
                          letterSpacing: ".1em",
                          minHeight: 34,
                          padding: "0 10px",
                          borderRadius: 7,
                          border: "1px solid rgb(var(--accent-rgb) / .4)",
                          background: "transparent",
                          color: busy === name ? "var(--text-off)" : "var(--accent-link)",
                        }}
                      >
                        {busy === name ? "…" : irButton}
                      </button>
                    ) : null}

                    <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontSize: 15,
                          color: "var(--accent-link)",
                        }}
                      >
                        {ir ? "—" : (values.get(name) ?? 0).toFixed(1)}
                      </div>
                      {/* --text-faint measures 2.86:1 against this card, which is
                          under the floor. The quietest tone that still reads. */}
                      <div
                        data-basis={live ? "points" : "projection"}
                        style={{ ...MICRO, letterSpacing: ".16em", color: "var(--text-dim)" }}
                      >
                        {live ? "PTS" : "PROJ"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The two chips under a name: what he is, and what he is worth.
 *
 * Boxes rather than a line of text, and lit rather than merely coloured. A
 * rank has a meaning a manager reads instantly — RB4 is a first-rounder, RB44
 * is a drop — and that meaning is not in the digits, it is in where they sit
 * against what the league starts. So the chip carries the tier: a filled,
 * glowing box for a man in the top half of the startable ranks, an outlined
 * one for the rest of the starters, and a flat recessed one for depth.
 *
 * The rate chip is filled in proportion to the best rate anybody at that
 * position is managing, so the bar behind the number is the same comparison
 * the number is making. Full means nobody at his position is doing better.
 *
 * Coloured by position rather than by good-and-bad. The palette already has a
 * colour per position and it is the one used everywhere else a player is
 * tinted; a green-to-red scale here would be a second vocabulary saying a
 * blunter version of the same thing.
 */
function FormChips({
  position,
  standing,
  fielded,
  out,
  lead,
}: {
  position: string;
  standing: { rank: number; ppg: number; games: number; bestPpg: number } | null;
  fielded: number;
  out: boolean;
  /** His club and his role, which used to have a line to themselves. */
  lead?: string;
}) {
  // Three words on a line of their own cost the roster a screen and a half.
  //
  // "WSH · WR2" is seventeen pixels of text and twenty of line box, on every
  // one of fifteen rows, sitting above two chips that leave most of their own
  // line empty. Put in front of them it reads the same and is free — and the
  // chips keep their order, so a manager scanning down the column of ranks
  // still scans down a column.
  const before = lead ? (
    <span
      style={{
        ...MICRO,
        letterSpacing: 0,
        fontSize: 11,
        color: "var(--text-dim)",
        flex: "0 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        alignSelf: "center",
      }}
    >
      {lead}
    </span>
  ) : null;
  // Stashed on injured reserve. He is out of the week entirely, and a rank
  // beside a man who cannot play is a number about somebody who is not there.
  if (out) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
        {before}
        <span style={{ ...CHIP, ...FLAT, color: "var(--text-dim)" }}>ON RESERVE</span>
      </div>
    );
  }

  // Nothing scored yet, league-wide: a preseason roster, or the hours before
  // the first Sunday. A chip claiming a rank here would be inventing one.
  if (!standing || !position) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
        {before}
        <span style={{ ...CHIP, ...FLAT, color: "var(--text-dim)" }}>NOT YET RANKED</span>
      </div>
    );
  }

  const tier = tierOf(standing.rank, fielded);
  const hue = POSITION_RGB[position] ?? "var(--accent-rgb)";
  const ink = POSITION_INK[position] ?? "var(--accent-text)";

  // How full the rate chip runs. Against the best at the position, so a full
  // bar is a real claim rather than a rounding of the roster.
  const share =
    standing.bestPpg > 0 ? Math.max(0, Math.min(1, standing.ppg / standing.bestPpg)) : 0;

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 7, marginTop: 5 }}>
      {before}
      <span
        data-chip="rank"
        title={
          fielded
            ? `${position}${standing.rank} of the ${fielded} this league starts`
            : `${position}${standing.rank} in the league's pool`
        }
        style={{
          ...CHIP,
          fontFamily: "var(--font-heading)",
          letterSpacing: ".08em",
          color: tier === "depth" ? "var(--text-dim)" : ink,
          border:
            tier === "depth"
              ? "1px solid rgb(var(--accent-rgb) / .2)"
              : `1px solid rgb(${hue} / ${tier === "elite" ? ".85" : ".45"})`,
          background:
            tier === "elite"
              ? `rgb(${hue} / .22)`
              : tier === "starter"
                ? `rgb(${hue} / .1)`
                : "rgb(var(--raised-rgb) / .5)",
          // The glow is the whole difference between a chip and a badge. Only
          // the top half of the startable ranks gets one, or it stops meaning
          // anything.
          boxShadow: tier === "elite" ? `0 0 12px rgb(${hue} / .3)` : "none",
        }}
      >
        {`${position}${standing.rank}`}
      </span>

      <span
        data-chip="ppg"
        title={
          standing.games
            ? `${standing.ppg.toFixed(1)} a week over ${standing.games} ${standing.games === 1 ? "game" : "games"}`
            : "No games played yet"
        }
        style={{
          ...CHIP,
          position: "relative",
          overflow: "hidden",
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          background: "rgb(var(--raised-rgb) / .5)",
          color: "var(--text)",
        }}
      >
        {/* Behind the number rather than beside it: the chip is the bar. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: `${(share * 100).toFixed(0)}%`,
            background: `linear-gradient(90deg, rgb(${hue} / .08), rgb(${hue} / .28))`,
            transition: "width .5s cubic-bezier(.2,.8,.2,1)",
          }}
        />
        <span style={{ position: "relative" }}>
          {standing.games ? `${standing.ppg.toFixed(1)} PPG` : "— PPG"}
        </span>
      </span>
    </div>
  );
}

const CHIP: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".1em",
  padding: "4px 9px",
  borderRadius: 5,
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.3,
};

const FLAT: React.CSSProperties = {
  ...MICRO,
  border: "1px solid rgb(var(--accent-rgb) / .18)",
  background: "rgb(var(--raised-rgb) / .4)",
};

/** The position palette the rest of the app tints players with. */
const POSITION_RGB: Record<string, string> = {
  QB: "var(--pos-qb-rgb)",
  RB: "var(--pos-rb-rgb)",
  WR: "var(--pos-wr-rgb)",
  TE: "var(--pos-te-rgb)",
  K: "var(--pos-k-rgb)",
  "D/ST": "var(--pos-dst-rgb)",
};

const POSITION_INK: Record<string, string> = {
  QB: "var(--pos-qb)",
  RB: "var(--pos-rb)",
  WR: "var(--pos-wr)",
  TE: "var(--pos-te)",
  K: "var(--pos-k)",
  "D/ST": "var(--pos-dst)",
};
