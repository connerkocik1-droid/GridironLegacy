"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "./Skeleton";
import PlayerName from "./PlayerName";
import { useRefreshable } from "@/lib/use-refresh";
import { flagColor, flagsFor, player, proj, type LeagueShape } from "@/lib/roster";
import { optimalLineup, startRates } from "@/lib/start-rate";
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
 * The projection says what he is worth. The start rate says how often that is
 * enough to beat the other four receivers on the same roster — which is the
 * number that decides whether to keep him, and the one no ordering can show.
 * The slot chip marks the arrangement projection alone would pick today.
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

const MICRO: React.CSSProperties = { fontSize: 10, letterSpacing: ".14em" };

/** What the league fields at this position, said in the group header. */
function startsLabel(pos: string, league: LeagueShape | null): string {
  const n = league?.starters?.[pos as keyof NonNullable<LeagueShape["starters"]>] ?? 0;
  if (!n) return "";
  return n === 1 ? "1 START" : `${n} START`;
}

export default function MyTeamRoster() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  // Whichever it is, it is the basis for all three numbers on a row — the
  // points, the slot chips and the start rates — so they never disagree about
  // which week they are describing.
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

  // Four hundred simulated weeks. Cheap enough to do here rather than on the
  // server, and it must not be done on the server anyway: it depends on the
  // roster, which changes under a waiver claim, and a cached rate would be
  // wrong in exactly the week somebody is deciding whether to make one.
  const rates = useMemo(
    () => (feed ? startRates(feed.roster, feed.settings, values) : new Map<string, number>()),
    [feed, values],
  );

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

      <p
        style={{
          padding: "2px 0 14px",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--text-quiet)",
          margin: 0,
        }}
      >
        Best ball — the highest-scoring legal lineup is taken for you every week. Highlighted
        players are the ones it would take right now; start rate is how often they land in it
        across four hundred simulated weeks.
      </p>

      {groups.map((group) => {
        const ir = group.pos === "IR";
        const starts = ir ? "" : startsLabel(group.pos, feed.settings);

        return (
          <div key={group.pos} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 8 }}>
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
                const rate = Math.round((rates.get(name) ?? 0) * 100);
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
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "11px 13px",
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

                      {line ? (
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
                          {line}
                        </div>
                      ) : null}

                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <div
                          style={{
                            flex: 1,
                            height: 3,
                            borderRadius: 99,
                            background: "rgb(var(--accent-rgb) / .14)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${ir ? 0 : rate}%`,
                              borderRadius: 99,
                              background: slot
                                ? "linear-gradient(90deg,var(--accent-deep),var(--accent-link))"
                                : rate >= 30
                                  ? "rgb(var(--accent-bright-rgb) / .45)"
                                  : "rgb(var(--accent-rgb) / .28)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            ...MICRO,
                            letterSpacing: ".1em",
                            color: "var(--text-dim)",
                            flex: "0 0 auto",
                          }}
                        >
                          {ir ? "OUT" : `${rate}% START RATE`}
                        </span>
                      </div>
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
                      <div style={{ ...MICRO, letterSpacing: ".16em", color: "var(--text-dim)" }}>
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
