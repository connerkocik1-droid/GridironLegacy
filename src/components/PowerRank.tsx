"use client";

import Link from "next/link";
import PresenceDot from "./PresenceDot";
import { useState } from "react";
import type { PowerRow } from "@/lib/home-types";

/**
 * Who is actually good, and who is moving.
 *
 * A ranking without movement is a table. The arrow is the part somebody opens
 * the page for — it is the only number here that says something happened since
 * last week rather than something is true — so it gets colour and the rating
 * does not.
 *
 * Five rows by default. Twelve is the whole league and the whole league is a
 * page of its own; the top five is the shape of the season.
 */

const TOP = 5;

export default function PowerRank({ power }: { power: PowerRow[] }) {
  const [all, setAll] = useState(false);
  if (!power.length) return null;

  const shown = all ? power : power.slice(0, TOP);
  const best = Math.max(1, ...power.map((t) => t.rating));

  return (
    <div
      style={{
        border: "1px solid rgb(var(--accent-rgb) / .22)",
        borderRadius: "var(--radius-lg)",
        background: "rgb(var(--surface-rgb) / .55)",
        overflow: "hidden",
      }}
    >
      {shown.map((t, i) => (
        <Link
          key={t.id}
          href={t.mine ? "/lineup" : `/team/${encodeURIComponent(t.id)}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "11px 13px",
            minHeight: 44,
            textDecoration: "none",
            color: "inherit",
            borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
            background: t.mine ? "rgb(var(--accent-rgb) / .12)" : undefined,
          }}
        >
          <span
            style={{
              width: 16,
              flex: "0 0 auto",
              fontFamily: "var(--font-heading)",
              fontSize: 12,
              color: "var(--text-dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.rank}
          </span>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 13.5,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.franchise}{" "}
              <PresenceDot online={Boolean(t.online)} who={t.franchise} size={6} />
              {t.mine ? <span style={{ color: "var(--accent-link)", fontSize: 10 }}> · YOU</span> : null}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.name}
              {t.avgAge != null ? ` · avg age ${t.avgAge.toFixed(1)}` : ""}
              {` · ${t.pointsFor.toFixed(1)} PF`}
            </div>
            {/* The rating as a bar as well as a number: twelve numbers in a
                column are hard to compare, twelve bars are not. */}
            <div
              style={{
                height: 4,
                borderRadius: 2,
                marginTop: 6,
                background: "rgb(var(--sunken-rgb) / .8)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(3, (t.rating / best) * 100)}%`,
                  height: "100%",
                  background: "linear-gradient(90deg,var(--accent-deep),var(--accent-link))",
                }}
              />
            </div>
          </div>

          <Movement places={t.movement} />
        </Link>
      ))}

      {power.length > TOP ? (
        <button
          onClick={() => setAll((v) => !v)}
          style={{
            width: "100%",
            minHeight: 42,
            border: "none",
            borderTop: "1px solid rgb(var(--accent-rgb) / .18)",
            background: "transparent",
            color: "var(--accent-link)",
            font: "inherit",
            fontSize: 10.5,
            letterSpacing: ".16em",
            cursor: "pointer",
          }}
        >
          {all ? "SHOW TOP 5" : `ALL ${power.length} TEAMS`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Places gained or lost since the last graded week.
 *
 * A dash for both "nothing has been graded yet" and "did not move", which are
 * different facts with the same honest picture: nothing to show. An arrow
 * would have to invent a direction for the first of them.
 */
function Movement({ places }: { places: number | null }) {
  if (!places) {
    return (
      <span style={{ width: 34, textAlign: "right", color: "var(--text-faint)", fontSize: 12, flex: "0 0 auto" }}>
        —
      </span>
    );
  }

  const up = places > 0;
  return (
    <span
      style={{
        width: 34,
        flex: "0 0 auto",
        textAlign: "right",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        color: up ? "var(--good)" : "var(--bad-soft)",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(places)}
    </span>
  );
}
