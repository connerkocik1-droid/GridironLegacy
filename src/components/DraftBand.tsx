"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Home } from "@/lib/home-types";

/**
 * Draft night, on the home page, until it has happened.
 *
 * Before the schedule exists there is no matchup, no score and no table — the
 * home page in the preseason was one card saying there were no fixtures and a
 * door to the mini-games. Meanwhile the only thing happening in this league,
 * the thing eleven people signed up for, was a date the app knew and never
 * mentioned outside the draft room.
 *
 * It says three things and stops: when, how long that is, and the way in. Once
 * the draft is over it is gone, and the page is the scoreboard it becomes.
 */

/** "Saturday 24 August, 7:00 PM", in whichever zone the phone is in. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * How far off it is, in the words somebody would use.
 *
 * Coarse on purpose: a countdown to the second belongs in the room, where it
 * is the ceremony. Here it only has to answer "have I got time to do anything
 * about my queue".
 */
function howFar(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "now";

  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins} ${mins === 1 ? "minute" : "minutes"}`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export default function DraftBand({ home }: { home: Home | null }) {
  // Its own clock, because "in 3 days" has to become "tomorrow" without
  // waiting for the next poll — and a minute is plenty for something this
  // coarse. The page's own thirty-second poll is for scores.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const league = home?.league;
  // Nothing once it is done — and nothing at all until the feed has arrived,
  // because a band that appears and then vanishes is worse than one that
  // arrives a moment late.
  if (!league || league.draftState === "complete") return null;

  const at = league.draftAt ?? null;
  const running = league.draftState === "running" || league.draftState === "paused";
  const far = at ? howFar(at, now) : null;

  return (
    <Link
      href="/draft"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgba(224,181,115,.45)",
        borderRadius: "var(--radius-lg)",
        background: "rgba(224,181,115,.08)",
        padding: "14px 16px",
        margin: "0 0 4px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: ".24em", color: "#e0b573" }}>
          {running ? "THE DRAFT IS ON" : "DRAFT NIGHT"}
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 17,
            color: "#e9e9ed",
            margin: "5px 0 0",
          }}
        >
          {running
            ? "In progress"
            : at
              ? when(at)
              : "No date set yet"}
        </div>
        <div style={{ fontSize: 11.5, color: "#9397ab", marginTop: 3 }}>
          {running
            ? "Somebody is on the clock."
            : at && far
              ? far === "now"
                ? "Any moment. The commissioner opens the room."
                : `${far.charAt(0).toUpperCase()}${far.slice(1)} — queue the players you want.`
              : "The commissioner sets the date in the league office."}
        </div>
      </div>
      <span aria-hidden style={{ color: "#e0b573", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
