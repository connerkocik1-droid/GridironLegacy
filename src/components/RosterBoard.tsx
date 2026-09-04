"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { headshot, logo, statLine } from "@/data/league-data";
import PlayerName from "./PlayerName";
import TeamCrest from "./TeamCrest";
import { bestLineup, type Score } from "@/lib/matchup";
import { flagColor, flagsFor, player, proj, type LeagueShape } from "@/lib/roster";
import { useLogos } from "@/lib/use-logos";
import { healthOf, useHealthReport } from "@/lib/use-player-health";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** How often a page left open on a Sunday goes and asks for the numbers. */
const POLL_MS = 60_000;

/** Who may be stashed: ruled out, not merely doubted. */
const STASHABLE = ["out", "ir", "suspended"];

interface Feed {
  week: number;
  me: { id: string; slot: string; franchise: string };
  settings: LeagueShape | null;
  roster: string[];
  injuredReserve: string[];
  live: boolean;
  started: boolean;
  weekPhase: "upcoming" | "live" | "final";
  final: boolean;
  scores: Record<string, { points: number; statLine: string }>;
}

/**
 * Your team, in a league where you do not pick who plays.
 *
 * This was a lineup editor. Best ball took the editing away — and with it the
 * Sunday morning spent checking who is active, the bench player who went for
 * thirty, and the week somebody lost because they were on a plane at one
 * o'clock. What is left is worth more than what went: the whole roster plays,
 * the slots fill themselves from whoever is actually scoring, and they keep
 * refilling until the last game ends.
 *
 * So the page shows the roster first and the arrangement second, and only
 * claims an arrangement once there is something real to arrange. Before
 * kickoff every score is nought and any lineup drawn from them would be
 * fiction; the projected order is shown, and labelled as a projection.
 */
export default function RosterBoard() {
  const logos = useLogos();
  const health = useHealthReport();
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

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Stashing somebody, or bringing him back. Deliberately a round trip rather
  // than an optimistic move: the reserve has a size and a roster has a
  // capacity, and both are decided in the database.
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

  const scores = useMemo(
    () =>
      new Map<string, Score>(
        Object.entries(feed?.scores ?? {}).map(([name, s]) => [
          name,
          { points: s.points, statLine: s.statLine },
        ]),
      ),
    [feed],
  );

  // The arrangement as it stands this second. Real points once the slate has
  // started — the same rule the matchup page shows and the database grades —
  // and the projected order before that, because there is nothing else.
  const rows = useMemo(() => {
    if (!feed) return [];
    return bestLineup(
      feed.roster,
      feed.settings,
      scores,
      feed.started ? "points" : "projection",
    );
  }, [feed, scores]);

  const starting = useMemo(
    () => new Set(rows.flatMap((r) => (r.entry ? [r.entry.name] : []))),
    [rows],
  );

  const rest = useMemo(() => {
    if (!feed) return [];
    return feed.roster
      .filter((name) => !starting.has(name))
      .sort((a, b) => value(b, scores, feed.started) - value(a, scores, feed.started));
  }, [feed, scores, starting]);

  const total = rows.reduce((sum, r) => sum + (r.entry?.points ?? 0), 0);

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading your roster…</div>;
  }

  const stashLimit = Number(feed.settings?.ir ?? 0);
  const settled = feed.final || feed.weekPhase === "final";
  const totalLabel = settled ? "FINAL" : feed.started ? "LIVE TOTAL" : "PROJECTED";

  return (
    <>
      <div
        style={{
          padding: "24px 26px 12px",
          display: "flex",
          alignItems: "flex-end",
          gap: 26,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>
            DYNASTY · BEST BALL
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "var(--font-heading)",
              fontSize: 44,
              lineHeight: 1.04,
              letterSpacing: "-.035em",
              margin: "8px 0 0",
            }}
          >
            <TeamCrest
              franchise={feed.me.franchise}
              logo={logos[feed.me.id] ?? null}
              size={40}
              shape="box"
              fallback="empty"
            />
            {feed.me.franchise}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, color: "#d2cefd" }}>
            {total.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c" }}>{totalLabel}</div>
        </div>
      </div>

      <div
        style={{
          padding: "0 26px 8px",
          fontSize: 12,
          color: "#9397ab",
          maxWidth: "70ch",
          lineHeight: 1.6,
        }}
      >
        {settled
          ? "This week is settled. Your best possible lineup is the one that counted — you did not have to be anywhere to get it."
          : feed.started
            ? "Your whole roster is playing. The highest scorers fill the slots by themselves and swap as the numbers move; wherever they land when the last game ends is what counts."
            : "There is no lineup to set. Every player you own is in, and when the games start the highest scorers fill the slots automatically. The order below is a projection until then."}
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      <div style={{ padding: "12px 26px 40px" }}>
        <div
          style={{
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
          <SectionHeader
            title={settled ? "How it finished" : feed.started ? "Filling the slots" : "Projected to start"}
            note={`WEEK ${feed.week}`}
          />

          {rows.map((row, i) => (
            <PlayerRow
              key={`${row.slot}-${i}`}
              slot={row.slot}
              name={row.entry?.name ?? null}
              score={row.entry?.name ? scores.get(row.entry.name) : undefined}
              starter
            />
          ))}

          <SectionHeader
            title="Also on the roster"
            note={`${rest.length} ${rest.length === 1 ? "PLAYER" : "PLAYERS"}`}
            muted
          />

          {rest.length === 0 ? (
            <div style={{ padding: "14px 18px", fontSize: 12, color: "#75798c" }}>
              Everybody you own is in a slot.
            </div>
          ) : (
            rest.map((name) => {
              const p = player(name);
              return (
                <PlayerRow
                  key={name}
                  slot={p?.p === "D/ST" ? "DST" : (p?.p ?? "—")}
                  name={name}
                  score={scores.get(name)}
                  action={
                    // Offered only to somebody the injury report has ruled
                    // out, because that is the only case the server will
                    // accept — a button that always refuses is worse than no
                    // button. Questionable is not enough: he might play.
                    stashLimit > 0 &&
                    feed.injuredReserve.length < stashLimit &&
                    STASHABLE.includes(healthOf(health, name)?.status ?? "active")
                      ? { label: "IR", title: `Stash ${name} on injured reserve`,
                          busy: busy === name, onClick: () => void stash(name, true) }
                      : undefined
                  }
                />
              );
            })
          )}
        </div>

        {stashLimit > 0 ? (
          <div
            style={{
              border: "1px solid rgba(145,132,217,.22)",
              borderRadius: "var(--radius-lg)",
              background: "rgba(26,28,43,.55)",
              overflow: "hidden",
              marginTop: 14,
            }}
          >
            <SectionHeader
              title="Injured reserve"
              note={`${feed.injuredReserve.length} OF ${stashLimit}`}
              muted
            />
            {feed.injuredReserve.length === 0 ? (
              <div
                style={{
                  padding: "14px 18px",
                  fontSize: 12,
                  color: "#75798c",
                  lineHeight: 1.6,
                }}
              >
                Nobody stashed. A player ruled out can sit here without costing a
                roster spot — he scores nothing while he does.
              </div>
            ) : (
              feed.injuredReserve.map((name) => {
                const p = player(name);
                return (
                  <PlayerRow
                    key={name}
                    slot={p?.p === "D/ST" ? "DST" : (p?.p ?? "—")}
                    name={name}
                    action={{
                      label: "ACTIVATE",
                      title: `Bring ${name} back onto the roster`,
                      busy: busy === name,
                      onClick: () => void stash(name, false),
                    }}
                  />
                );
              })
            )}
          </div>
        ) : null}

        {/* Said once, at the bottom, where somebody who has scrolled the whole
            roster and is wondering where the bench went will find it. */}
        <div
          style={{
            marginTop: 12,
            fontSize: 11.5,
            color: "#75798c",
            lineHeight: 1.6,
            maxWidth: "70ch",
          }}
        >
          Nobody here is benched. Everyone below the slots is still eligible to fill
          one — a player who outscores a starter takes his place while the games
          are on.
        </div>
      </div>
    </>
  );
}

/** What a player is worth right now, by the same rule the slots are filled on. */
function value(name: string, scores: Map<string, Score>, started: boolean): number {
  if (started) return scores.get(name)?.points ?? 0;
  return scores.get(name)?.points ?? proj(name);
}

function SectionHeader({ title, note, muted }: { title: string; note: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 18px",
        borderTop: muted ? "1px solid rgba(145,132,217,.18)" : undefined,
        background: muted ? "rgba(20,22,35,.5)" : undefined,
      }}
    >
      <h6 style={{ margin: 0, color: muted ? "#9397ab" : "#d2cefd" }}>{title}</h6>
      <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>{note}</span>
    </div>
  );
}

interface RowAction {
  label: string;
  title: string;
  busy: boolean;
  onClick: () => void;
}

function PlayerRow({
  slot,
  name,
  score,
  starter,
  action,
}: {
  slot: string;
  name: string | null;
  score?: { points: number; statLine: string };
  starter?: boolean;
  action?: RowAction;
}) {
  const p = name ? player(name) : null;
  const flags = name ? flagsFor(name) : [];
  const live = score != null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: starter ? "12px 18px" : "11px 18px",
        borderTop: "1px solid rgba(145,132,217,.12)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 10,
          letterSpacing: ".14em",
          width: 38,
          flex: "0 0 auto",
          color: starter ? "#b5abfc" : "#75798c",
        }}
      >
        {slot === "D/ST" ? "DST" : slot}
      </span>

      {name ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headshot(name) || BLANK}
            alt=""
            width={starter ? 34 : 30}
            height={starter ? 34 : 30}
            style={{
              borderRadius: "50%",
              objectFit: "contain",
              border: "1px solid rgba(145,132,217,.3)",
              background: "rgba(35,37,50,.7)",
              flex: "0 0 auto",
            }}
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            {/* Wraps, so the badges drop to their own line rather than
                squeezing the name down to an initial. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                rowGap: 4,
                flexWrap: "wrap",
              }}
            >
              <PlayerName
                name={name}
                style={{ fontFamily: "var(--font-heading)", fontSize: starter ? 15 : 14 }}
              />
              {p?.t ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo(p.t)}
                  alt=""
                  width={15}
                  height={15}
                  style={{ objectFit: "contain", opacity: 0.85, flex: "0 0 auto" }}
                />
              ) : null}
              {flags.map((f) => (
                <span
                  key={f.label}
                  style={{
                    fontSize: 10,
                    letterSpacing: ".12em",
                    padding: "2px 5px",
                    borderRadius: 2,
                    flex: "0 0 auto",
                    border: `1px solid ${flagColor(f.kind)}66`,
                    color: flagColor(f.kind),
                  }}
                >
                  {f.label}
                </span>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: live ? "#9397ab" : "#75798c",
                marginTop: 3,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {live ? score.statLine : p ? statLine(p) : ""}
            </div>
          </div>

          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: starter ? 17 : 15,
                color: live ? "#d2cefd" : "#b2b6ca",
              }}
            >
              {(live ? score.points : proj(name)).toFixed(1)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
              {live ? "LIVE" : "PROJ"}
            </div>
          </div>

          {action ? (
            <button
              onClick={action.onClick}
              disabled={action.busy}
              title={action.title}
              aria-label={action.title}
              style={{
                minHeight: 34,
                padding: "6px 10px",
                border: "1px solid rgba(145,132,217,.35)",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: action.busy ? "#5a5d6e" : "#b5abfc",
                font: "inherit",
                fontSize: 10,
                letterSpacing: ".12em",
                cursor: action.busy ? "default" : "pointer",
                flex: "0 0 auto",
              }}
            >
              {action.busy ? "…" : action.label}
            </button>
          ) : null}
        </>
      ) : (
        <div style={{ flex: 1, fontSize: 13, color: "#5a5d6e" }}>
          Nobody on the roster plays here
        </div>
      )}
    </div>
  );
}
