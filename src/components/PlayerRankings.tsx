"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { headshot } from "@/data/league-data";
import {
  COLUMNS,
  filter,
  rank,
  type Group,
  type LeaguePoints,
  type Row,
} from "@/lib/rankings";

/**
 * Every player in the pool, ranked, with the statistics that mean something
 * for the position you are looking at.
 *
 * A quarterback and a kicker do not belong in the same columns, so the toggle
 * changes the table rather than filtering one fixed set of headings. Points
 * and points per game stay put across all of them, because that is the
 * comparison every manager is actually making.
 */

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const ORDER: Group[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];

const TINT: Record<string, string> = {
  QB: "#e5a3a3",
  RB: "#8fd3b0",
  WR: "#a8b8e8",
  TE: "#e0bb84",
  K: "#b0a8cc",
  "D/ST": "#a8a8bb",
};

const PAGE = 50;

const tab = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: active ? "rgba(145,132,217,.24)" : "transparent",
  color: active ? "#e9e9ed" : "#8f94a8",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 10.5,
  letterSpacing: ".14em",
  padding: "7px 13px",
  cursor: "pointer",
});

const th: React.CSSProperties = {
  fontSize: 8.5,
  letterSpacing: ".16em",
  color: "#75798c",
  fontWeight: 400,
  textAlign: "right",
  padding: "0 0 9px",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 13,
  color: "#b2b6ca",
  textAlign: "right",
  padding: "9px 0",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/** A stat that does not exist for this player, shown as absent not as zero. */
function cell(value: number | null | undefined, dp: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(dp);
}

export default function PlayerRankings() {
  const [group, setGroup] = useState<Group>("ALL");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [league, setLeague] = useState<LeaguePoints>({});
  const [rostered, setRostered] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<"league" | "2025">("2025");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setLeague(body.points ?? {});
      setRostered(body.rostered ?? {});
      setBasis(body.basis ?? "2025");
    } catch {
      // The table still works on last season's numbers; the league's own
      // scoring is the part that needs the network.
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Ranking the whole pool is real work; it should not happen on a keystroke.
  const rows = useMemo(() => rank(league, rostered), [league, rostered]);

  const visible = useMemo(() => {
    const inGroup = filter(rows, group);
    const q = query.trim().toLowerCase();
    return q ? inGroup.filter((r) => r.name.toLowerCase().includes(q)) : inGroup;
  }, [rows, group, query]);

  const columns = COLUMNS[group];

  function choose(next: Group) {
    setGroup(next);
    setShown(PAGE);
  }

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>THE POOL</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        Player rankings
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.6, margin: "0 0 16px", maxWidth: "68ch" }}>
        {basis === "league"
          ? "Points are what this league has actually awarded. "
          : "Points are last season's finish, until this league has played a week. "}
        Every other column is a 2025 statistic, per game played rather than per
        game on the calendar.
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {ORDER.map((g) => (
          <button
            key={g}
            onClick={() => choose(g)}
            aria-current={g === group ? "page" : undefined}
            style={tab(g === group)}
          >
            {g}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShown(PAGE);
        }}
        placeholder="Search for a player…"
        aria-label="Search for a player"
        style={{
          width: "100%",
          maxWidth: 320,
          padding: "8px 11px",
          background: "rgba(20,22,35,.8)",
          border: "1px solid rgba(145,132,217,.3)",
          borderRadius: "var(--radius-sm)",
          color: "#e9e9ed",
          font: "inherit",
          fontSize: 13,
          marginBottom: 14,
        }}
      />

      <div
        style={{
          border: "1px solid rgba(145,132,217,.22)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(26,28,43,.55)",
          // A quarterback's five extra columns do not fit a phone; the table
          // scrolls inside its own box rather than the whole page going wide.
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", padding: "14px 15px 9px", width: "40%" }}>
                {visible.length} {visible.length === 1 ? "PLAYER" : "PLAYERS"}
              </th>
              {columns.map((c) => (
                <th key={c.key} style={{ ...th, paddingRight: 15 }} title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, shown).map((r, i) => (
              <PlayerRow key={r.name} row={r} rank={i + 1} columns={columns} />
            ))}
          </tbody>
        </table>

        {!visible.length ? (
          <div style={{ padding: "18px 15px", fontSize: 12.5, color: "#9397ab" }}>
            Nobody matches that.
          </div>
        ) : null}
      </div>

      {shown < visible.length ? (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          style={{
            marginTop: 14,
            padding: "10px 22px",
            border: "1px solid rgba(181,171,252,.5)",
            background: "rgba(145,132,217,.14)",
            color: "#d2cefd",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 11,
            letterSpacing: ".14em",
            cursor: "pointer",
          }}
        >
          SHOW {Math.min(PAGE, visible.length - shown)} MORE
        </button>
      ) : null}
    </div>
  );
}

function PlayerRow({
  row,
  rank,
  columns,
}: {
  row: Row;
  rank: number;
  columns: { key: string; dp: number }[];
}) {
  return (
    <tr style={{ borderTop: "1px solid rgba(145,132,217,.1)" }}>
      <td style={{ padding: "8px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              flex: "0 0 auto",
              width: 22,
              fontFamily: "var(--font-heading)",
              fontSize: 11,
              color: "#5a5d6e",
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {rank}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headshot(row.name) || BLANK}
            alt=""
            width={28}
            height={28}
            style={{
              flex: "0 0 auto",
              borderRadius: "50%",
              objectFit: "contain",
              border: "1px solid rgba(145,132,217,.3)",
              background: "rgba(35,37,50,.7)",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: "#e9e9ed",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.name}
            </div>
            <div style={{ fontSize: 9.5, color: "#75798c", whiteSpace: "nowrap" }}>
              <span style={{ color: TINT[row.position] ?? "#75798c" }}>{row.position}</span>
              {" · "}
              {row.team}
              {row.bye ? ` · BYE ${row.bye}` : ""}
              {row.franchise ? ` · ${row.franchise}` : " · free agent"}
            </div>
          </div>
        </div>
      </td>

      {columns.map((c) => {
        const value = c.key === "total" ? row.total : c.key === "ppg" ? row.ppg : row.stats[c.key];
        const lead = c.key === "total" || c.key === "ppg";
        return (
          <td key={c.key} style={{ ...td, paddingRight: 15, color: lead ? "#d2cefd" : "#b2b6ca" }}>
            {cell(value, c.dp)}
          </td>
        );
      })}
    </tr>
  );
}
