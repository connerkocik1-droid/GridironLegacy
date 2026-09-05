"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSeen, writeSeen, STALE_MS, type Seen } from "@/lib/last-seen";
import type { Home } from "@/lib/home-types";

/**
 * What happened while you were away.
 *
 * The one question every fantasy app leaves you to answer yourself. You put
 * the phone down at half past one with a six-point lead; you pick it up at
 * five and the screen says 104.6, which is a number and not an answer. Every
 * platform shows you the state and none of them shows you the change, so a
 * manager reconstructs their own afternoon from memory, every week.
 *
 * Two facts, because two is what fits on a line somebody reads in passing:
 * where the game went, and how busy the league has been. Both are things this
 * app already knows — the mark is a timestamp in this browser and the rest is
 * arithmetic.
 *
 * It is deliberately quiet about itself. Nothing under half an hour is worth
 * a band, nothing that has not moved is worth a band, and it is gone the
 * moment it has been read.
 */

interface Props {
  home: Home | null;
}

/** The mark advances once it is fair to say the band has been seen. */
const READ_MS = 12_000;

function gapWords(mine: number, theirs: number): string {
  const margin = Math.abs(mine - theirs);
  if (margin < 0.05) return "level";
  return `${margin.toFixed(1)} ${mine > theirs ? "in front" : "behind"}`;
}

export default function SinceYouLooked({ home }: Props) {
  // The mark as it stood on arrival, and whether it is old enough to be worth
  // a sentence. Both decided once, in the effect below: `Date.now()` during a
  // render is impure, and a band that appears and disappears depending on when
  // React happened to re-render is worse than no band.
  const [seen, setSeen] = useState<Seen | null>(null);
  const [stale, setStale] = useState(false);
  const [moves, setMoves] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const asked = useRef(false);
  const laid = useRef(false);

  // This manager's own game, if they have one this week.
  const game = useMemo(() => home?.games.find((g) => g.mine) ?? null, [home]);
  const side = useMemo(() => {
    if (!game || !home) return null;
    const mine = game.home.id === home.meId ? game.home : game.away;
    const theirs = game.home.id === home.meId ? game.away : game.home;
    return { mine: mine.total, theirs: theirs.total, who: theirs.franchise };
  }, [game, home]);

  // Read once, on mount, rather than on every render: the mark is about to be
  // overwritten by this very visit, and the band has to be built from what it
  // said on arrival.
  useEffect(() => {
    const mark = readSeen();
    if (!mark) return;
    const age = Date.now() - new Date(mark.at).getTime();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(mark);
    setStale(age > STALE_MS);
  }, []);

  // Only when there is something to be behind on. Most loads never ask.
  useEffect(() => {
    if (!stale || asked.current || !seen) return;
    asked.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/activity?limit=40", { cache: "no-store" });
        if (!res.ok) return;
        const feed = (await res.json()) as { entries?: { at: string }[] };
        const since = new Date(seen.at).getTime();
        setMoves((feed.entries ?? []).filter((e) => new Date(e.at).getTime() > since).length);
      } catch {
        // The league's moves are the second half of the sentence. Without them
        // the first half still stands.
        setMoves(0);
      }
    })();
  }, [stale, seen]);

  /** Stamps this visit, which is what makes the band go away. */
  const markRead = useCallback(() => {
    writeSeen({
      at: new Date().toISOString(),
      mine: side?.mine ?? null,
      theirs: side?.theirs ?? null,
    });
    setGone(true);
  }, [side]);

  // A first visit ever, or one close behind the last: no band, and the mark
  // moves on quietly so the next visit has something to measure from. Once,
  // and only once the scores have arrived — a mark written against a null
  // score is a mark that can say nothing next time.
  useEffect(() => {
    if (!home || stale || laid.current) return;
    laid.current = true;
    writeSeen({
      at: new Date().toISOString(),
      mine: side?.mine ?? null,
      theirs: side?.theirs ?? null,
    });
  }, [home, stale, side]);

  // Shown, and therefore read. Twelve seconds is long enough to take in two
  // clauses and short enough that a band nobody dismissed does not follow
  // somebody around for a week.
  const showing = !gone && stale && home != null;
  useEffect(() => {
    if (!showing) return;
    const timer = setTimeout(markRead, READ_MS);
    return () => clearTimeout(timer);
  }, [showing, markRead]);

  if (!showing || !seen) return null;

  // What the game did. Only where both ends of the comparison exist and the
  // week is one that has scores in it.
  const swing =
    side && seen.mine != null && seen.theirs != null && (home.started || home.weekPhase === "final")
      ? {
          was: gapWords(seen.mine, seen.theirs),
          now: gapWords(side.mine, side.theirs),
          turned:
            seen.mine - seen.theirs === 0
              ? false
              : Math.sign(seen.mine - seen.theirs) !== Math.sign(side.mine - side.theirs),
          moved: Math.abs(side.mine - seen.mine) >= 0.05,
        }
      : null;

  const busy = moves != null && moves > 0;

  // Nothing changed. Then there is nothing to say, and saying it anyway is
  // how a feature like this becomes something people learn to ignore.
  if (!swing?.moved && !busy) return null;

  return (
    <div
      className="gl-since"
      style={{
        border: `1px solid ${swing?.turned ? "rgb(var(--accent-bright-rgb) / .55)" : "rgb(var(--accent-rgb) / .28)"}`,
        borderRadius: "var(--radius-md)",
        background: "rgb(var(--accent-rgb) / .1)",
        padding: "12px 14px 13px",
        marginBottom: 12,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".2em",
            color: "var(--accent-link)",
            marginBottom: 6,
          }}
        >
          SINCE YOU LOOKED
        </div>

        {swing?.moved ? (
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
            {swing.turned ? (
              <>
                It turned over. You were <strong style={{ color: "var(--text)" }}>{swing.was}</strong>{" "}
                against {side?.who} and you are now{" "}
                <strong style={{ color: "var(--text)" }}>{swing.now}</strong>.
              </>
            ) : (
              <>
                You were <strong style={{ color: "var(--text)" }}>{swing.was}</strong> against{" "}
                {side?.who}. Now <strong style={{ color: "var(--text)" }}>{swing.now}</strong>.
              </>
            )}
          </div>
        ) : null}

        {busy ? (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-muted)",
              marginTop: swing?.moved ? 5 : 0,
              lineHeight: 1.55,
            }}
          >
            {moves === 1 ? "One move" : `${moves} moves`} in the league.
          </div>
        ) : null}
      </div>

      <button
        onClick={markRead}
        aria-label="Caught up"
        className="gl-round"
        // A mark rather than a button: it is the quietest thing in the band and
        // must not compete with the sentence it sits beside. Still a full
        // thumb-sized target — gl-round sees to that on a phone — it just
        // does not draw a ring around itself to prove it.
        style={{
          width: 26,
          height: 26,
          flex: "0 0 auto",
          border: "none",
          borderRadius: "50%",
          background: "transparent",
          color: "var(--text-dim)",
          fontFamily: "inherit",
          fontSize: 15,
          lineHeight: 1,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
