"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NewsWire from "./NewsWire";
import Skeleton from "./Skeleton";
import { useRefreshable } from "@/lib/use-refresh";
import { healthOf, useHealthReport } from "@/lib/use-player-health";
import { ROLES } from "@/data/league-data";
import type { Story } from "@/lib/news";

/**
 * The wire, narrowed to the players this manager has a stake in.
 *
 * Which is the roster and the watchlist together: the player you do not hold
 * yet is exactly the one whose hamstring you want to hear about before you
 * spend a claim on him. Same rule the /news?view=players filter uses, and the
 * same stories — this is a view of one wire, not a second one.
 *
 * The chips sort by why a story matters to you rather than by what it says.
 * The design authored a `kind` onto each story; ESPN does not send one, and
 * guessing it from the headline would put a man on the injury list because
 * somebody wrote "cut" about his snap count. So the kind comes from what the
 * app already knows about the player the story names:
 *
 *   Injury — he is on today's injury report, from the same feed the badge
 *            beside his name is drawn from.
 *   Role   — his depth-chart role is conditional, the asterisk the roster
 *            rows already show.
 *   Other  — everything else about somebody you hold or are watching.
 *
 * A story naming two of your players takes the loudest of them, because a chip
 * that hides a hamstring behind a depth-chart note is worse than no chip.
 */

type Kind = "Injury" | "Role" | "Other";
const KINDS: readonly ("All" | Kind)[] = ["All", "Injury", "Role", "Other"];

/** On an injury report at all, rather than merely mentioned in one. */
const HURT = ["out", "ir", "doubtful", "questionable", "suspended"];

export default function MyTeamNews() {
  const health = useHealthReport();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [mine, setMine] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | Kind>("All");

  const load = useCallback(async () => {
    const [wire, lineup, watching] = await Promise.all([
      fetch("/api/news", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/lineup", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/watchlist", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (!wire) return setError("Could not reach the wire.");
    setStories((wire.stories ?? []) as Story[]);
    setError(null);

    if (lineup) {
      setMine(
        new Set<string>([
          ...((lineup.roster ?? []) as string[]),
          ...((lineup.injuredReserve ?? []) as string[]),
          ...((watching?.players ?? []) as string[]),
        ]),
      );
    }
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const kindOf = useCallback(
    (story: Story, names: Set<string>): Kind => {
      const theirs = story.players.filter((p) => names.has(p));
      if (theirs.some((p) => HURT.includes(healthOf(health, p)?.status ?? "active"))) {
        return "Injury";
      }
      if (theirs.some((p) => /\*/.test(ROLES[p]?.role ?? ""))) return "Role";
      return "Other";
    },
    [health],
  );

  const theirs = useMemo(() => {
    if (!stories || !mine) return [];
    return stories.filter((s) => s.players.some((p) => mine.has(p)));
  }, [stories, mine]);

  const shown = useMemo(
    () => (filter === "All" || !mine ? theirs : theirs.filter((s) => kindOf(s, mine) === filter)),
    [theirs, filter, mine, kindOf],
  );

  if (error) {
    return <div style={{ padding: "0 18px", color: "var(--warn)", fontSize: 12.5 }}>{error}</div>;
  }
  if (!stories || !mine) {
    return <Skeleton rows={4} />;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: "0 18px 14px",
        }}
      >
        {KINDS.map((k) => {
          const on = k === filter;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={on}
              style={{
                cursor: "pointer",
                flex: "0 0 auto",
                fontFamily: "inherit",
                fontSize: 11,
                letterSpacing: ".1em",
                minHeight: 34,
                padding: "7px 13px",
                borderRadius: 99,
                border: `1px solid ${on ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
                background: on ? "rgb(var(--accent-rgb) / .18)" : "transparent",
                color: on ? "var(--text)" : "var(--text-dim)",
              }}
            >
              {k.toUpperCase()}
            </button>
          );
        })}
      </div>

      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .2)",
          borderRadius: "var(--radius-lg)",
          background: "rgb(var(--surface-rgb) / .72)",
          overflow: "hidden",
          margin: "0 18px",
        }}
      >
        <NewsWire
          stories={shown}
          highlight={mine}
          emptyMessage={
            theirs.length
              ? "Nothing on the wire under that heading. Your players are in the other chips."
              : "Nothing on the wire about your players yet. It refreshes every fifteen minutes."
          }
        />
      </div>
    </div>
  );
}
