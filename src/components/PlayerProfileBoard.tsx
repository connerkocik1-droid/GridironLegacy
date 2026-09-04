"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NewsWire from "./NewsWire";
import { HEALTH_COLOUR, HEALTH_LABEL } from "@/lib/health";
import { healthOf, useHealthReport } from "@/lib/use-player-health";
import type { PlayerProfile } from "@/lib/player-profile";
import type { Story } from "@/lib/news";

/**
 * One player, on a page of his own.
 *
 * Reachable from his name anywhere it appears, which is the point: a manager
 * looking at a lineup and wondering about somebody should not have to go and
 * look him up on another site.
 *
 * In the order the question comes in: is he fit, what kind of player is he,
 * what has he done — this season as one line, last season as another — and
 * what is being said about him. The season line opens into the weeks behind
 * it, because the total answers "is he producing" and only the weeks answer
 * "is he still producing", and the second question is asked far less often.
 */

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

/**
 * The one earlier season the page shows.
 *
 * Written out rather than imported from player-profile, which is where the
 * filtering happens: that module reaches into the 20-0 export, and a client
 * component that imports a value from it drags four hundred kilobytes of
 * historical seasons into this route for the sake of one number.
 */
const LAST_SEASON = 2025;

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
};

interface Payload {
  profile: PlayerProfile;
  news: Story[];
  season: {
    year: number | null;
    weeks: { week: number; points: number; statLine: string }[];
    /** The whole season as one line, in the wording of his position. */
    statLine: string;
    total: number;
    best: number;
  } | null;
  owner: { slot: string; franchise: string; mine: boolean; lineupSlot: string } | null;
}

export default function PlayerProfileBoard({ name }: { name: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openWeeks, setOpenWeeks] = useState(false);
  const report = useHealthReport();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/player/${encodeURIComponent(name)}`, { cache: "no-store" });
      if (!res.ok) return setError("Could not read that player.");
      setData(await res.json());
    } catch {
      setError("Could not read that player.");
    }
  }, [name]);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "#e0b573" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "#75798c" }}>
        Reading the player…
      </div>
    );
  }

  const { profile, news, season, owner } = data;
  const health = healthOf(report, profile.name);
  const weeks = season?.weeks ?? [];
  const played = weeks.filter((w) => w.points !== 0 || w.statLine);
  const hasBio = Boolean(profile.archetype || profile.insight || profile.adp != null);

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 18px 44px" }}>
      {/* ------------------------------------------------------- who he is --- */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "26px 0 18px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={profile.headshot || BLANK}
          alt=""
          width={72}
          height={72}
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(145,132,217,.35)",
            background: "rgba(35,37,50,.7)",
            flex: "0 0 auto",
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 28,
              letterSpacing: "-.025em",
              margin: 0,
              fontWeight: 500,
              color: "#e9e9ed",
              overflowWrap: "anywhere",
            }}
          >
            {profile.name}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginTop: 7,
              flexWrap: "wrap",
              fontSize: 12,
              color: "#9397ab",
            }}
          >
            {profile.position ? <span>{profile.position}</span> : null}
            {profile.team ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={profile.teamLogo || BLANK} alt="" width={15} height={15}
                  style={{ objectFit: "contain", opacity: 0.85 }} />
                {profile.team}
              </span>
            ) : null}
            {profile.bye ? <span>bye {profile.bye}</span> : null}

            {/* Always, and always in the same place. Active says nothing,
                because everybody not on a report is fit and a page of ticks
                hides the one word that matters. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                borderRadius: 2,
                border: `1px solid ${HEALTH_COLOUR[health?.status ?? "active"]}55`,
                color: HEALTH_COLOUR[health?.status ?? "active"],
                fontSize: 10.5,
                letterSpacing: ".08em",
                fontWeight: 600,
              }}
            >
              {HEALTH_LABEL[health?.status ?? "active"]}
            </span>
          </div>

          {health?.note ? (
            <div style={{ fontSize: 11.5, color: "#9397ab", marginTop: 7, lineHeight: 1.5 }}>
              {health.detail}
              {health.note ? ` — ${health.note}` : ""}
            </div>
          ) : null}
        </div>
      </div>

      {owner ? (
        <div style={{ ...card, padding: "11px 16px", fontSize: 12, color: "#9397ab", marginBottom: 16 }}>
          {owner.mine ? (
            <>
              On <span style={{ color: "#7fd1a8" }}>your roster</span>
              {owner.lineupSlot === "IR" ? ", on injured reserve" : ""}.
            </>
          ) : (
            <>
              Held by <span style={{ color: "#e9e9ed" }}>{owner.franchise}</span>.
            </>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ bio --- */}
      {/* Above the numbers on purpose: who he is frames what the numbers mean,
          and a stat line read before the player is read is just arithmetic. */}
      {hasBio ? (
        <>
          <div style={{ ...label, marginBottom: 10 }}>THE SCOUTING LINE</div>
          <div style={{ ...card, padding: "14px 16px", marginBottom: 24 }}>
            {profile.archetype ? (
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 15,
                  color: "#d2cefd",
                  marginBottom: 7,
                }}
              >
                {profile.archetype}
              </div>
            ) : null}
            {profile.insight ? (
              <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.65, margin: 0 }}>
                {profile.insight}
              </p>
            ) : null}
            {profile.adp != null ? (
              <div style={{ fontSize: 11, color: "#75798c", marginTop: 10 }}>
                Drafted around pick {profile.adp}
                {profile.posRank ? ` · ${profile.posRank}` : ""}
                {profile.rostered != null ? ` · rostered in ${profile.rostered}% of leagues` : ""}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* --------------------------------------------------- this season --- */}
      <div style={{ ...label, marginBottom: 10 }}>
        THIS SEASON{season?.year ? ` · ${season.year}` : ""}
      </div>
      <div style={{ ...card, marginBottom: 24 }}>
        {played.length ? (
          <>
            <button
              type="button"
              onClick={() => setOpenWeeks((was) => !was)}
              aria-expanded={openWeeks}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: 0,
                background: "transparent",
                font: "inherit",
                color: "inherit",
                padding: "13px 16px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                <Stat label="POINTS" value={(season?.total ?? 0).toFixed(1)} />
                <Stat label="WEEKS" value={String(played.length)} />
                <Stat label="BEST" value={(season?.best ?? 0).toFixed(1)} />
                <Stat
                  label="PER WEEK"
                  value={(played.length ? (season?.total ?? 0) / played.length : 0).toFixed(1)}
                />
              </div>

              {season?.statLine ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#c8ccdc",
                    lineHeight: 1.5,
                    marginTop: 11,
                    overflowWrap: "anywhere",
                  }}
                >
                  {season.statLine}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 9,
                  fontSize: 11,
                  color: "#b5abfc",
                }}
              >
                {openWeeks ? "Hide the weeks" : "Week by week"}
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    transform: openWeeks ? "rotate(180deg)" : "none",
                    transition: "transform .15s ease",
                  }}
                >
                  ⌄
                </span>
              </div>
            </button>

            {openWeeks
              ? played.map((w) => (
                  <div
                    key={w.week}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "10px 16px",
                      borderTop: "1px solid rgba(145,132,217,.14)",
                      alignItems: "baseline",
                    }}
                  >
                    <span style={{ ...label, width: 46, flex: "0 0 auto" }}>WK {w.week}</span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        color: "#c8ccdc",
                        lineHeight: 1.45,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {w.statLine || "—"}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 15,
                        color: "#d2cefd",
                        fontVariantNumeric: "tabular-nums",
                        flex: "0 0 auto",
                      }}
                    >
                      {w.points.toFixed(1)}
                    </span>
                  </div>
                ))
              : null}
          </>
        ) : (
          <div style={{ padding: "16px 18px", fontSize: 12.5, color: "#9397ab", lineHeight: 1.6 }}>
            Nothing scored yet this season. Weeks appear here as they are played.
          </div>
        )}
      </div>

      {/* ----------------------------------------------------- last year --- */}
      {/* 2025 and this season, and nothing else. The historical pool reaches
          back to 2002, but a profile is read while a decision is being made
          this week and a man's 2014 has no bearing on it.

          The pool keeps standout seasons rather than every season, so most
          players have no 2025 row in it. That is said out loud: an empty space
          where a season should be reads as "he did not play". */}
      {profile.found ? (
        <>
          <div style={{ ...label, marginBottom: 10 }}>LAST SEASON · {LAST_SEASON}</div>
          <div style={{ ...card, marginBottom: 24 }}>
            {profile.career.length === 0 ? (
              <div style={{ padding: "14px 16px", fontSize: 12, color: "#9397ab", lineHeight: 1.6 }}>
                No {LAST_SEASON} line on file for him.
              </div>
            ) : null}
            {profile.career.map((s) => (
              <div
                key={`${s.year}-${s.team}`}
                style={{ padding: "12px 16px", borderTop: "1px solid rgba(145,132,217,.14)" }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 14,
                      color: "#e9e9ed",
                    }}
                  >
                    {s.year}
                  </span>
                  <span style={{ fontSize: 11, color: "#75798c" }}>
                    {s.team} · {s.position}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#c8ccdc", marginTop: 4, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                  {s.line}
                </div>
                {s.line2 ? (
                  <div style={{ fontSize: 11.5, color: "#9397ab", marginTop: 2, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                    {s.line2}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* ---------------------------------------------------------- news --- */}
      <div style={{ ...label, marginBottom: 10 }}>WHAT THE WIRE SAYS</div>
      <div style={{ ...card, marginBottom: 24 }}>
        <NewsWire
          stories={news.slice(0, 6)}
          highlight={new Set([profile.name])}
          emptyMessage={`Nothing about ${profile.name} on the wire just now.`}
        />
      </div>

      {!profile.found ? (
        <div style={{ ...card, padding: "14px 16px", fontSize: 12, color: "#9397ab", lineHeight: 1.6 }}>
          This player was never in the draft pool, so there is nothing here but
          what the league itself has recorded about him.
        </div>
      ) : null}

      <div style={{ marginTop: 20, fontSize: 11.5 }}>
        <Link
          href="/rankings"
          style={{
            color: "#b5abfc",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          Every player, by position →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label: name, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c" }}>{name}</div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 19,
          marginTop: 3,
          color: "#e9e9ed",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
