"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TeamMark from "./TeamMark";
import Skeleton from "./Skeleton";
import LiveNumber from "./LiveNumber";
import TeamCrest from "./TeamCrest";
import WinProbability from "./WinProbability";
import { gameLabel } from "@/lib/nfl-week";
import { headshot } from "@/data/league-data";
import { useLogos } from "@/lib/use-logos";
import PlayerName from "./PlayerName";
import { useRefreshable } from "@/lib/use-refresh";
import type { MatchupRow, SideEntry } from "@/lib/matchup";

interface Side {
  id: string;
  slot: string;
  /** Whoever holds the franchise. */
  name?: string;
  franchise: string;
  total: number;
  /** Where the week is expected to finish, banked points included. */
  projected?: number;
  yetToPlay?: number;
  inPlay?: number;
  record?: { w: number; l: number; t: number };
}

/** A week this manager sits out. There is no fixture, so there is no board. */
interface Bye {
  week: number;
  managers: { id: string; slot: string; franchise: string }[];
  /** Whether the left-hand column is the person reading it. */
  mine?: boolean;
}

interface Board {
  week: number;
  home: Side;
  away: Side;
  rows: MatchupRow[];
  /** A game on the slate is in progress this second. */
  live: boolean;
  /** Anything on the slate has kicked off, so these are results not guesses. */
  started: boolean;
  /** The week is settled: this arrangement is the one that was recorded. */
  final: boolean;
  managers: { id: string; slot: string; franchise: string }[];
  /** Whether the left-hand column is the person reading it. */
  mine?: boolean;
  /** The chance the left-hand side wins. See win-probability.ts. */
  winProbability?: number | null;
}

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * One player in one half of a row. `align` flips the layout so the two sides
 * mirror each other around the slot label in the middle.
 */
function PlayerCell({
  entry,
  align,
  leading,
}: {
  entry: SideEntry | null;
  align: "left" | "right";
  leading: boolean;
}) {
  const reverse = align === "right";
  // His own game, not the league's week: at one o'clock half a lineup has
  // finished and half has not kicked off.
  const started = entry ? (entry.game ? entry.game.state !== "pre" : entry.live) : false;

  if (!entry) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: reverse ? "flex-end" : "flex-start",
          minWidth: 0,
          color: "var(--text-faint)",
          fontSize: 12,
          padding: "0 4px",
        }}
      >
        Empty
      </div>
    );
  }

  return (
    <div
      className="gl-mcell"
      style={{
        display: "flex",
        flexDirection: reverse ? "row-reverse" : "row",
        alignItems: "center",
        // The stat line claims a whole line of its own below (flexBasis 100%),
        // so the name and the score share the first one. A quarterback's line
        // is six parts long and these columns are half a phone wide; sitting it
        // beside the name would leave the name about two letters.
        flexWrap: "wrap",
        rowGap: 2,
        gap: 10,
        minWidth: 0,
        padding: "0 4px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="gl-mcell-face"
        src={headshot(entry.name) || BLANK}
        alt=""
        width={32}
        height={32}
        style={{
          borderRadius: "50%",
          objectFit: "contain",
          border: "1px solid rgb(var(--accent-rgb) / .3)",
          background: "rgb(var(--raised-rgb) / .7)",
          flex: "0 0 auto",
        }}
      />

      <div
        className="gl-mcell-name"
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: reverse ? "row-reverse" : "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ minWidth: 0 }}>
          <PlayerName
            name={entry.name}
            style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}
          />
        </span>
        <TeamMark team={entry.team} size={14} opacity={0.85} className="gl-mcell-team" />
      </div>

      <div
        className="gl-mcell-pts"
        style={{ flex: "0 0 auto", textAlign: align === "left" ? "right" : "left", width: 46 }}
      >
        {/* What he has scored, and under it what he was expected to. Both,
            always, because either alone is unreadable: a bare 0.0 could be a
            disaster or a kickoff four hours away, and a bare projection hides
            the afternoon that has actually happened. A dash rather than 0.0
            until his game starts, because he has not scored nothing — he has
            not played. */}
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            color: leading ? "var(--accent-text)" : "var(--text-3)",
          }}
        >
          {started ? <LiveNumber key={entry.name} value={entry.points} /> : "–"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
          {entry.projected.toFixed(2)}
        </div>
      </div>

      {/* Wraps rather than clips. These columns are narrow and a quarterback's
          line is five parts long, so an ellipsis would hide exactly the
          touchdowns somebody opened the page to see. */}
      <div
        className="gl-mcell-line"
        style={{
          flexBasis: "100%",
          fontSize: 10,
          color: "var(--text-dim)",
          lineHeight: 1.45,
          overflowWrap: "anywhere",
          textAlign: align,
        }}
      >
        {/* Before kickoff the useful thing is who he plays and when; once
            there is a stat line, that is. Falls back to the position and team
            for a man whose game the league does not know about. */}
        {entry.statLine ||
          gameLabel(entry.game) ||
          `${entry.position}${entry.team ? ` · ${entry.team}` : ""}`}
      </div>
    </div>
  );
}

/** "0-0", or "0-0-1" only once somebody has actually tied. */
function recordText(record?: { w: number; l: number; t: number }): string {
  if (!record) return "";
  return `${record.w}-${record.l}${record.t ? `-${record.t}` : ""}`;
}

/** Who they are and how their year has gone, under the score. */
function SideFooter({ side, align }: { side: Side; align: "left" | "right" }) {
  const who = [side.name, side.record ? recordText(side.record) : ""].filter(Boolean).join(" · ");
  const line: React.CSSProperties = {
    display: "block",
    fontSize: 10.5,
    color: "var(--text-dim)",
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      {who ? <div style={line}>{who}</div> : null}
      {/* How much football is left, which is what turns a scoreline into a
          state of play. Hidden before anybody kicks off, when every side in
          the league says the same thing. */}
      {side.yetToPlay != null && (side.yetToPlay > 0 || (side.inPlay ?? 0) > 0) ? (
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {side.inPlay ? `${side.inPlay} in play · ` : ""}
          {side.yetToPlay} to play
        </div>
      ) : null}
    </div>
  );
}

/** One half of the header: crest, score, projection, name, record. */
function HeadSide({
  side,
  logo,
  align,
  leading,
  eyebrow,
  href,
}: {
  side: Side;
  logo: string | null;
  align: "left" | "right";
  leading: boolean;
  eyebrow: string;
  href: string;
}) {
  const right = align === "right";
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="gl-mhead-top"
        style={{
          display: "flex",
          flexDirection: right ? "row-reverse" : "row",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        <TeamCrest franchise={side.franchise} logo={logo} size={44} shape="circle" />
        <div style={{ minWidth: 0, textAlign: align }}>
          <div
            className="gl-mhead-score"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 38,
              lineHeight: 1.05,
              fontVariantNumeric: "tabular-nums",
              color: leading ? "var(--accent-text)" : "var(--text)",
            }}
          >
            <LiveNumber key={side.id} value={side.total} />
          </div>
          {side.projected != null ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {side.projected.toFixed(1)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Straight into their roster. This screen shows the seven or eight men
          filling slots today; the question it raises is what else they have,
          and that used to mean opening a trade with them to find out.
          
          One link over the whole block rather than one on the name and another
          on the manager: they go to the same place, and two 16px-tall targets
          stacked is neither of them thumb-sized. */}
      <Link
        href={href}
        style={{
          display: "block",
          textAlign: align,
          marginTop: 8,
          minWidth: 0,
          minHeight: 44,
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: ".24em", color: "var(--text-dim)" }}>{eyebrow}</div>
        <div
          className="gl-mhead-name"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        <SideFooter side={side} align={align} />
      </Link>
    </div>
  );
}

/**
 * `embedded` drops the small heading above the scoreline. Under the My Team
 * screen the sub-tab already says "Matchup" over a header that already names
 * the franchise, and a second "Your matchup" under both is a label repeating
 * itself.
 */
export default function MatchupBoard({ embedded = false }: { embedded?: boolean } = {}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [bye, setBye] = useState<Bye | null>(null);
  // Who the schedule says you are playing, remembered from the load that had
  // no opponent forced on it. Once one is forced the response stops saying,
  // and without this there is no way back to your own game.
  const [scheduled, setScheduled] = useState<{ id: string; franchise: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logos = useLogos();
  const router = useRouter();
  // The board is on two pages — /lineup and the Matchup tab of /my-team — so
  // the dropdown has to write back to whichever one it is on. Hard-coding
  // /lineup here would throw a My Team reader out of My Team.
  const pathname = usePathname();
  // Read from the router, not from window.location.
  //
  // These were lazy useState initialisers reading window.location.search, on
  // the reasoning that the address is read once at mount and useSearchParams
  // would cost a Suspense boundary. Both halves of that were wrong. A soft
  // navigation — which is what pressing a fixture is — renders this component
  // before window.location has caught up, so the initialiser read the *old*
  // address, found no home and no opponent, and asked for the reader's own
  // game. Then, because an initialiser never runs twice, it stayed wrong.
  //
  // It survived a browser check because the check opened each fixture with a
  // full page load, which is the one case where window.location is already
  // right. Nobody reaches the page that way.
  const params = useSearchParams();

  // The left-hand franchise, when it is not the person reading: a fixture
  // between two others, opened from the list or the home page. The way out of
  // it is back to your own game rather than swapping a side.
  const asHome = params.get("home") ?? "";
  // The matchups list shows a whole season, and without this every card in it
  // opened the week in play instead of the week drawn on the card.
  const asWeek = params.get("week") ?? "";
  // Who you are being put beside. The dropdown writes it to the address and
  // reads it back from there, so the address is the only copy — two copies
  // are what let this disagree with itself in the first place.
  const opponent = params.get("opponent") ?? "";

  /**
   * Choosing an opponent, and saying so in the address bar.
   *
   * This board can put you beside anybody in the league, and until now the
   * only way to ask was a dropdown on this page — so a franchise named on any
   * other screen was a dead end. It is a query parameter now, which makes
   * "you against them" a place rather than a state: the matchups list links
   * into it, a back button leaves it, and a reload keeps it.
   *
   * replace rather than push: it is the same page showing a different pair,
   * and stacking a history entry per dropdown fiddle would make the back
   * button mean "undo my last comparison" eleven times over.
   *
   * Through the router rather than history.replaceState, because the address
   * is now the only copy of which pair is on screen — a bare replaceState
   * changes the bar without telling React, and the board would go on showing
   * the previous game.
   */
  const choose = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("opponent", id);
      else next.delete("opponent");
      const query = next.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );


  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (asHome) params.set("home", asHome);
      if (asWeek) params.set("week", asWeek);
      if (opponent) params.set("opponent", opponent);
      const query = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/matchup${query}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your matchup.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));

      const body = await res.json();

      // A bye answers 200, because sitting out a week is a fact about the
      // schedule rather than a fault — and it comes back without the two
      // sides, because there are not two sides. This screen used to read
      // `board.home.total` off it and take the whole page down with it: an
      // odd-numbered league gives somebody a bye every single week, and every
      // one of them opened this page to a crash.
      if (!body?.home || !body?.away) {
        setBye({
          week: body?.week ?? 0,
          // Everybody but you. The route sends the whole roster, and the
          // first version of this offered a manager their own franchise as
          // somebody else's game to watch.
          managers: (body?.managers ?? []).filter(
            (m: { id: string }) => m.id !== body?.me?.id,
          ),
        });
        setBoard(null);
        setError(null);
        return;
      }

      setBye(null);
      setBoard(body);
      if (!opponent) setScheduled({ id: body.away.id, franchise: body.away.franchise });
      setError(null);
    } catch {
      setError("Could not load this week's matchup.");
    }
  }, [opponent, asHome, asWeek]);

  // Answers a pull-to-refresh as well as its own timer.
  useRefreshable(load);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (bye) {
    return <ByeWeek bye={bye} onCompare={choose} />;
  }
  if (!board) {
    return <Skeleton rows={5} />;
  }

  const homeLeads = board.home.total > board.away.total;
  const awayLeads = board.away.total > board.home.total;

  // "Up" and "down" mean nothing about somebody else's Sunday, so a game the
  // reader is not in is stated rather than taken personally.
  const gap = Math.abs(board.home.total - board.away.total);

  // Two other franchises, opened from a fixture on the home page. The header
  // cannot say "YOU" over somebody else's team, and the opponent dropdown
  // would mean "swap who they are playing", which is not a question anybody
  // has. So both become plain names, and there is a way back to your own week.
  const mine = board.mine !== false;

  const leader = homeLeads ? board.home.franchise : board.away.franchise;
  const margin =
    !board.started || gap < 0.05
      ? ""
      : mine
        ? `${homeLeads ? "up" : "down"} ${gap.toFixed(1)}`
        : `${leader} by ${gap.toFixed(1)}`;

  return (
    <>
      {/* Kept when the game on screen is somebody else's, because then the
          heading is the only thing saying whose it is. */}
      <div
        hidden={embedded && mine}
        style={{ margin: "8px 20px 0", paddingTop: 22, borderTop: "1px solid rgb(var(--accent-rgb) / .18)" }}
      >
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>
          {mine ? "THIS WEEK" : "ELSEWHERE IN THE LEAGUE"}
        </div>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            letterSpacing: "-.02em",
            fontWeight: 500,
            margin: "5px 0 0",
          }}
        >
          {/* It said "Your matchup" over two other franchises, because it was
              printed by the page above this one, which cannot know. */}
          {mine ? "Your matchup" : `${board.home.franchise} vs ${board.away.franchise}`}
        </h2>
      </div>

      {/* The two totals face each other across the header, the same axis the
          rows below are built on. */}
      {/* The two totals face each other across the header, the same axis the
          rows below are built on: crest, score, and under it where the week is
          expected to finish. The projection is the number that makes a live
          score mean anything — 0.0 against 0.0 is every game in the league at
          noon on Sunday, and 113.7 against 125.1 is a reason to watch. */}
      <div
        className="gl-matchup-head"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
          alignItems: "start",
          gap: 14,
          padding: "22px 20px 14px",
        }}
      >
        <HeadSide
          side={board.home}
          logo={logos[board.home.id] ?? null}
          align="left"
          leading={homeLeads}
          eyebrow={mine ? "YOU" : board.home.slot}
          href={mine ? "/lineup" : `/team/${encodeURIComponent(board.home.id)}`}
        />

        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>
            WEEK {board.week}
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 12,
              color: "var(--accent-link)",
              margin: "6px 0",
            }}
          >
            VS
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: board.live ? "var(--good)" : "var(--text-dim)" }}>
            {board.live ? "LIVE" : board.started ? "SCORED" : "PROJECTED"}
          </div>
        </div>

        {/* The right-hand side is a dropdown when it is your own week, because
            this board can put you beside anybody. Opened as somebody else's
            fixture it is a plain name: "swap who they are playing" is not a
            question anybody has. */}
        {mine ? (
          <div style={{ minWidth: 0 }}>
            <div
              className="gl-mhead-top"
              style={{
                display: "flex",
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <TeamCrest
                franchise={board.away.franchise}
                logo={logos[board.away.id] ?? null}
                size={44}
                shape="circle"
              />
              <div style={{ minWidth: 0, textAlign: "right" }}>
                <div
                  className="gl-mhead-score"
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 38,
                    lineHeight: 1.05,
                    fontVariantNumeric: "tabular-nums",
                    color: awayLeads ? "var(--accent-text)" : "var(--text)",
                  }}
                >
                  <LiveNumber key={board.away.id} value={board.away.total} />
                </div>
                {board.away.projected != null ? (
                  <div style={{ fontSize: 12, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                    {board.away.projected.toFixed(1)}
                  </div>
                ) : null}
              </div>
            </div>

            <select
              value={opponent}
              aria-label="Opponent"
              onChange={(e) => choose(e.target.value)}
              className="gl-mhead-name"
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 16,
                marginTop: 8,
                maxWidth: "100%",
                padding: "2px 0",
                background: "transparent",
                color: "var(--text)",
                border: "1px solid transparent",
                borderRadius: "var(--radius-sm)",
                appearance: "none",
                textAlign: "right",
                textAlignLast: "right",
                cursor: "pointer",
              }}
            >
              {/* The list has to contain whatever is selected, or the control
                  renders empty. The scheduled opponent is the "" option;
                  everybody else is themselves; and on a bye there is no ""
                  option because there is no fixture. */}
              {(scheduled ? [{ value: "", label: scheduled.franchise }] : []).concat(
                board.managers
                  .filter((m) => m.id !== board.home.id && m.id !== scheduled?.id)
                  .map((m) => ({ value: m.id, label: m.franchise })),
              ).map((choice) => (
                <option key={choice.value || "scheduled"} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <Link
              href={`/team/${encodeURIComponent(board.away.id)}`}
              style={{
                display: "block",
                minHeight: 36,
                paddingTop: 2,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <SideFooter side={board.away} align="right" />
            </Link>
          </div>
        ) : (
          <HeadSide
            side={board.away}
            logo={logos[board.away.id] ?? null}
            align="right"
            leading={awayLeads}
            eyebrow={board.away.slot}
            href={`/team/${encodeURIComponent(board.away.id)}`}
          />
        )}
      </div>

      {/* The question the numbers above do not answer. The margin rides on the
          same line: this screen used to draw a second bar under this one for
          the share of the points, which said "DOWN 2.8" over a game the reader
          was not playing in. */}
      {board.winProbability != null ? (
        <div style={{ padding: "0 20px 14px" }}>
          <WinProbability p={board.winProbability} final={board.final} note={margin} />
        </div>
      ) : null}

      {/* The way out of somebody else's game. Without it the only way back is
          the browser's own back button, which is not a thing a tab bar app
          teaches anybody to reach for. */}
      {!mine ? (
        <div style={{ padding: "0 26px 4px" }}>
          <Link
            href="/lineup"
            style={{
              fontSize: 11,
              letterSpacing: ".14em",
              color: "var(--accent-link)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              minHeight: 34,
            }}
          >
            ‹ YOUR OWN MATCHUP
          </Link>
        </div>
      ) : null}

      <div
        style={{
          padding: "0 26px 10px",
          fontSize: 11.5,
          color: "var(--text-dim)",
          lineHeight: 1.6,
          maxWidth: "70ch",
        }}
      >
        {/* Short, because the roster above this on the same page has already
            said what best ball is. What this line adds is that it is true of
            both sides — the rest was said twice. */}
        {board.final
          ? "Neither manager chose these: best ball filled the slots."
          : board.started
            ? "Best ball, both sides: the highest scorers are filling the slots."
            : "Best ball, both sides. A projection until the games start."}
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "var(--warn)" }}>{error}</div>
      ) : null}

      <div style={{ padding: "0 26px 40px" }}>
        <div
          style={{
            border: "1px solid rgb(var(--accent-rgb) / .22)",
            borderRadius: "var(--radius-lg)",
            background: "rgb(var(--surface-rgb) / .55)",
            overflow: "hidden",
          }}
        >
          {board.rows.map((row, i) => {
            const homePoints = row.home?.points ?? 0;
            const awayPoints = row.away?.points ?? 0;

            return (
              <div
                key={`${row.slot}-${i}`}
                className="gl-matchup-row"
                style={{
                  display: "grid",
                  // One row per slot: my player, the slot label, their player.
                  gridTemplateColumns: "minmax(0,1fr) 62px minmax(0,1fr)",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 14px",
                  borderTop: i === 0 ? "none" : "1px solid rgb(var(--accent-rgb) / .12)",
                }}
              >
                <PlayerCell entry={row.home} align="left" leading={homePoints > awayPoints} />

                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-heading)",
                    fontSize: 10,
                    letterSpacing: ".14em",
                    color: "var(--accent-link)",
                    background: "rgb(var(--accent-rgb) / .12)",
                    borderRadius: "var(--radius-sm)",
                    padding: "5px 0",
                  }}
                >
                  {row.slot === "D/ST" ? "DST" : row.slot}
                </div>

                <PlayerCell entry={row.away} align="right" leading={awayPoints > homePoints} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * The week you are not playing.
 *
 * Said plainly rather than in the warning colour, because a bye is not a
 * fault and an amber line reads as one. And it does not stop at the bad news:
 * the same screen already knows how to put any two franchises side by side,
 * so a manager with nothing of their own to watch can pick a game to watch
 * instead — which is exactly what somebody on a bye is looking for.
 */
function ByeWeek({ bye, onCompare }: { bye: Bye; onCompare: (id: string) => void }) {
  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>
        WEEK {bye.week}
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 34,
          letterSpacing: "-.03em",
          margin: "8px 0 8px",
          fontWeight: 500,
        }}
      >
        You have a bye
      </h1>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 20px", lineHeight: 1.6, maxWidth: "60ch" }}>
        Nothing you do this week changes your record — but the rest of the league is playing, and
        any one of their games can be put on this screen instead.
      </p>

      {bye.managers.length ? (
        <>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 8 }}>
            WATCH SOMEBODY ELSE
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {bye.managers.map((m) => (
              <button
                key={m.id}
                onClick={() => onCompare(m.id)}
                style={{
                  minHeight: 34,
                  padding: "7px 12px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  color: "var(--text-2)",
                  background: "rgb(var(--surface-rgb) / .55)",
                  border: "1px solid rgb(var(--accent-rgb) / .24)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                {m.franchise}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
