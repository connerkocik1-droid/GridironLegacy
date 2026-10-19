"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  droppedOut,
  keyOf,
  movement,
  nflMeta,
  pollRanksFor,
  type BoardReport,
  type Entry,
  type Move,
  type Polls,
} from "@/lib/pylon-report";
import { byRating, tierOf, type ProspectBoard, type ProspectEntry } from "@/lib/pylon-draft-board";
import { rankTrail, ratingTrail, sparkFields, type SparkFields } from "@/lib/pylon-report-view";

/**
 * The Pylon Report, in full — ported from the "Pylon Report Web" design
 * handoff (prototype/Pylon Report Web.dc.html). No sign-in needed; a visitor
 * who followed a shared link is not a manager picking between My Team and
 * the Draft, so this gets its own light nav rather than the app's tab bar.
 *
 * The handoff's Nocturne tokens (--color-accent-300, --color-neutral-500,
 * …) don't exist in this app's theme, which has its own purple-accent scale
 * (theme.css). Rather than importing a second token system, every token the
 * handoff names is mapped onto this app's nearest equivalent below — same
 * visual effect (glass, glow, the accent ramp lighting up low ranks),
 * expressed in tokens this codebase already has.
 *
 * Logos are abbreviation tiles for now — the handoff's own designed empty
 * state (image-slot.js, the drag-and-drop widget it ships with, is a design
 * tool primitive built for a slide authoring surface and isn't ported here).
 * Real crests are a fast follow once there's an upload path keyed by abbr.
 */

const C = {
  bg: "var(--bg)",
  text: "var(--text)",
  accent: "rgb(var(--accent-rgb))",
  accent100: "rgb(var(--accent-bright-rgb))",
  accent200: "var(--accent-text)",
  accent300: "var(--accent-link)",
  accent700: "var(--accent-deep)",
  neutral200: "var(--text-2)",
  neutral300: "var(--text-3)",
  neutral400: "var(--text-muted)",
  neutral500: "var(--text-dim)",
  neutral600: "var(--text-faint)",
  good: "var(--good)",
  bad: "var(--bad-text)",
};

const glass = (opacity: "panel" | "nav" | "sheet"): React.CSSProperties => {
  const top = opacity === "nav" ? 0.07 : opacity === "sheet" ? 0.05 : 0.06;
  const bottom = opacity === "sheet" ? 0.01 : 0.015;
  const blur = opacity === "sheet" ? 26 : opacity === "panel" ? 22 : 24;
  return {
    background: `linear-gradient(180deg, rgb(var(--accent-rgb) / ${top}), rgb(var(--accent-rgb) / ${bottom}))`,
    backdropFilter: `blur(${blur}px) saturate(160%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(160%)`,
    border: "1px solid rgb(var(--accent-rgb) / .09)",
    boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .12), 0 16px 48px rgba(0,0,0,.4)",
    borderRadius: 6,
  };
};

const hairline: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg,transparent,rgb(var(--accent-rgb) / .1) 48px,rgb(var(--accent-rgb) / .1) calc(100% - 48px),transparent)",
  backgroundSize: "100% 1px",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "bottom",
};

type BoardKey = "cfb" | "nfl" | "p50";

export default function PylonReportPage({
  week,
  college,
  collegeBefore,
  collegeHistory,
  polls,
  nfl,
  nflBefore,
  nflHistory,
  bigBoard,
  bigBoardBefore,
  bigBoardWeek,
  bigBoardHistory,
}: {
  week: number | null;
  college: BoardReport;
  collegeBefore: BoardReport | null;
  collegeHistory: Record<string, (number | null)[]>;
  polls: Polls;
  nfl: BoardReport;
  nflBefore: BoardReport | null;
  nflHistory: Record<string, (number | null)[]>;
  bigBoard: ProspectBoard;
  bigBoardBefore: ProspectBoard | null;
  bigBoardWeek: number | null;
  bigBoardHistory: Record<string, (number | null)[]>;
}) {
  const [board, setBoard] = useState<BoardKey>("cfb");
  const [filter, setFilter] = useState("All");

  const switchBoard = (b: BoardKey) => {
    setBoard(b);
    setFilter("All");
  };

  const collegeMoves = useMemo(() => movement(college, collegeBefore), [college, collegeBefore]);
  const nflMoves = useMemo(() => movement(nfl, nflBefore), [nfl, nflBefore]);
  const dropped = useMemo(() => droppedOut(college, collegeBefore), [college, collegeBefore]);
  const bigBoardSorted = useMemo(() => byRating(bigBoard.ranked), [bigBoard]);

  const nothing = !college.ranked.length && !nfl.ranked.length && !bigBoard.ranked.length;

  const counts = { cfb: college.ranked.length, nfl: nfl.ranked.length, p50: bigBoard.ranked.length };
  const META: Record<BoardKey, { title: string; sub: string; hero: string }> = {
    cfb: { title: "CFB Top 25", sub: week != null ? `Week ${week} · Pylon, AP, Coaches, CFP` : "Pylon, AP, Coaches, CFP", hero: "College football Top 25" },
    nfl: { title: "NFL Power 32", sub: week != null ? `Week ${week} · all 32 teams` : "All 32 teams", hero: "NFL power rankings" },
    p50: { title: "Pylon 50", sub: "2027 draft class big board", hero: "The Pylon 50: the 2027 draft big board" },
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", background: C.bg, fontVariantNumeric: "tabular-nums" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={glow(-220, -160, 720, 620, "rgb(var(--glow-rgb) / .8)")} />
        <div style={glow(160, undefined, 640, 560, "rgb(var(--accent-rgb) / .22)", -220)} />
        <div style={glow(880, undefined, 760, 520, "rgb(var(--glow-rgb) / .85)", undefined, "28%")} />
      </div>

      <div style={{ position: "sticky", top: 0, zIndex: 20, padding: "14px 20px 0" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", ...glass("nav") }}>
          <PylonMark />
          <span style={{ display: "flex", alignItems: "baseline", gap: 7, flex: "0 0 auto", whiteSpace: "nowrap", fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", fontStyle: "italic" }}>
            <span style={{ fontWeight: 600 }}>Pylon</span>
            <span style={{ fontWeight: 400, color: C.accent300 }}>Fantasy</span>
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 24, fontSize: 13 }}>
            <Link href="/" style={{ color: C.neutral400 }}>Home</Link>
            <span style={{ color: C.text }}>The Pylon Report</span>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", maxWidth: 1120, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 1, background: C.accent }} />
            <span style={{ fontSize: 11, letterSpacing: ".3em", color: C.accent300 }}>THE PYLON REPORT</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: "clamp(30px,5vw,52px)", lineHeight: 1, letterSpacing: "-.04em", margin: "16px 0 0", fontStyle: "italic" }}>
            {META[board].hero}
          </h1>
        </div>

        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", overflow: "hidden", ...glass("panel") }}>
          {(["cfb", "nfl", "p50"] as BoardKey[]).map((k, i) => {
            const on = board === k;
            return (
              <button
                key={k}
                onClick={() => switchBoard(k)}
                style={{
                  position: "relative",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-body)",
                  padding: "16px 18px",
                  border: 0,
                  borderLeft: i ? "1px solid rgb(var(--accent-rgb) / .08)" : undefined,
                  background: on ? "rgb(var(--accent-rgb) / .12)" : "transparent",
                  borderRadius: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.01em", color: on ? C.text : C.neutral300 }}>
                    {META[k].title}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 20, fontWeight: 500, letterSpacing: "-.03em", color: C.neutral600 }}>
                    {counts[k]}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.neutral400, marginTop: 4 }}>{META[k].sub}</div>
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: `linear-gradient(90deg,transparent,${C.accent},transparent)`, opacity: on ? 1 : 0 }} />
              </button>
            );
          })}
        </div>

        {nothing ? (
          <p style={{ fontSize: 13, color: C.neutral400, textAlign: "center", marginTop: 60 }}>
            Nothing published yet. Check back after the commissioner&apos;s office puts this week&apos;s boards up.
          </p>
        ) : board === "cfb" ? (
          <CfbBoard college={college} dropped={dropped} moves={collegeMoves} polls={polls} history={collegeHistory} filter={filter} setFilter={setFilter} />
        ) : board === "nfl" ? (
          <NflBoard nfl={nfl} moves={nflMoves} history={nflHistory} filter={filter} setFilter={setFilter} />
        ) : (
          <P50Board
            entries={bigBoardSorted}
            before={bigBoardBefore}
            history={bigBoardHistory}
            week={bigBoardWeek}
            filter={filter}
            setFilter={setFilter}
          />
        )}
      </div>
    </div>
  );
}

function glow(top: number | undefined, left: number | undefined, w: number, h: number, color: string, right?: number, leftPct?: string): React.CSSProperties {
  return {
    position: "absolute",
    top,
    left: left ?? (leftPct as string | undefined),
    right,
    width: w,
    height: h,
    borderRadius: "50%",
    background: `radial-gradient(circle, ${color}, transparent 66%)`,
    filter: "blur(50px)",
  };
}

function PylonMark() {
  return (
    <svg width="12" height="23" viewBox="28 6 44 108" style={{ flex: "0 0 auto", overflow: "visible", filter: "drop-shadow(0 0 3px rgba(245,138,68,.7))" }}>
      <polygon points="32,20 50,30 50,110 32,100" style={{ fill: "rgba(255,180,106,.42)" }} />
      <polygon points="50,30 68,20 68,100 50,110" style={{ fill: "rgba(245,138,68,.72)" }} />
      <polygon points="50,8 70,19 50,30 30,19" style={{ fill: "#ffe2c4" }} />
      <polygon points="32,62 50,72 68,62 68,72 50,82 32,72" style={{ fill: "#161826", opacity: 0.75 }} />
      <line x1="50" y1="30" x2="50" y2="110" style={{ stroke: "#ffe2c4", strokeWidth: 4 }} />
    </svg>
  );
}

// ---------------------------------------------------------------- shared ---

function RankNumeral({ rank, max }: { rank: number; max: number }) {
  const lit = rank <= 5;
  return (
    <span
      style={{
        fontSize: 30,
        fontWeight: 300,
        fontStyle: "italic",
        letterSpacing: "-.06em",
        lineHeight: 1,
        ...(lit
          ? {
              background: `linear-gradient(170deg, ${C.accent100}, ${C.accent} 70%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(0 0 10px rgb(var(--accent-rgb) / .5))",
            }
          : { color: C.accent300, opacity: 0.9 - (rank / max) * 0.5 }),
      }}
    >
      {rank}
    </span>
  );
}

function ChangeChip({ move }: { move: Move | undefined }) {
  if (!move || move.kind === "new") {
    return (
      <span
        style={{
          justifySelf: "start",
          fontSize: 10,
          letterSpacing: ".1em",
          padding: "2px 6px",
          borderRadius: 2,
          background: "rgb(var(--accent-rgb) / .2)",
          color: C.accent100,
        }}
      >
        NEW
      </span>
    );
  }
  const label = move.kind === "held" ? "—" : `${move.kind === "up" ? "▲ " : "▼ "}${move.places}`;
  const color = move.kind === "up" ? C.accent300 : move.kind === "down" ? C.neutral400 : C.neutral600;
  return <span style={{ fontSize: 12, fontWeight: 500, color }}>{label}</span>;
}

function LogoTile({ abbr }: { abbr: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        flex: "0 0 auto",
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: ".04em",
        color: C.accent200,
        background: "rgb(var(--accent-rgb) / .14)",
        border: "1px solid rgb(var(--accent-rgb) / .22)",
      }}
    >
      {abbr}
    </div>
  );
}

function Sparkline({ fields }: { fields: SparkFields }) {
  const color = fields.better === true ? C.accent300 : fields.better === false ? C.neutral500 : C.neutral600;
  return (
    <svg width="72" height="22" viewBox="0 0 76 24" style={{ overflow: "visible", display: "block" }}>
      <polyline
        points={fields.spark}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={fields.better ? { filter: "drop-shadow(0 0 3px rgb(var(--accent-rgb) / .6))" } : undefined}
      />
      <circle cx={fields.endX} cy={fields.endY} r={2.6} fill={color} />
    </svg>
  );
}

function FilterChips({ options, filter, setFilter, showing, total }: {
  options: { label: string; count: number }[];
  filter: string;
  setFilter: (f: string) => void;
  showing: number;
  total: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap", marginTop: 44, paddingBottom: 2, ...hairline }}>
      {options.map((f) => (
        <button
          key={f.label}
          onClick={() => setFilter(f.label)}
          style={{
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            padding: "0 0 10px",
            border: 0,
            background: "transparent",
            color: filter === f.label ? C.text : C.neutral500,
            boxShadow: filter === f.label ? `inset 0 -2px 0 ${C.accent300}` : "none",
          }}
        >
          {`${f.label} · ${f.count}`}
        </button>
      ))}
      <span style={{ marginLeft: "auto", fontSize: 12, color: C.neutral500, paddingBottom: 10 }}>
        {showing === total ? `${total} shown` : `${showing} of ${total} shown`}
      </span>
    </div>
  );
}

function Insights({ items }: { items: { label: string; value: string; aside: string; note: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", marginTop: 32 }}>
      {items.map((s) => (
        <div key={s.label} style={{ padding: "2px 20px 2px 0", marginRight: 20, borderRight: "1px solid rgb(var(--accent-rgb) / .08)" }}>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: C.neutral500 }}>{s.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.025em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.value}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: C.accent300, flex: "0 0 auto" }}>{s.aside}</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: C.neutral400, marginTop: 6 }}>{s.note}</div>
        </div>
      ))}
    </div>
  );
}

function Footnotes({ items }: { items: { label: string; text: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
      {items.map((n) => (
        <div key={n.label} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: 12, color: C.neutral400 }}>
          <span style={{ fontSize: 10, letterSpacing: ".18em", color: C.neutral500 }}>{n.label}</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ CFB ---

function CfbBoard({
  college,
  dropped,
  moves,
  polls,
  history,
  filter,
  setFilter,
}: {
  college: BoardReport;
  dropped: Entry[];
  moves: Map<string, Move>;
  polls: Polls;
  history: Record<string, (number | null)[]>;
  filter: string;
  setFilter: (f: string) => void;
}) {
  const all = college.ranked;
  const confs = useMemo(() => Array.from(new Set(all.map((e) => e.conference).filter(Boolean))), [all]);
  const vis = filter === "All" ? all : all.filter((e) => e.conference === filter);

  const riser = useMemo(() => {
    let best: { e: Entry; places: number } | null = null;
    for (const e of all) {
      const m = moves.get(keyOf(e.team));
      if (m?.kind === "up" && (!best || m.places > best.places)) best = { e, places: m.places };
    }
    return best;
  }, [all, moves]);

  const split = useMemo(() => {
    let best: { e: Entry; gap: number } | null = null;
    for (const e of all) {
      const ap = pollRanksFor(e.team, polls).ap;
      if (ap == null) continue;
      const gap = ap - e.rank;
      if (!best || Math.abs(gap) > Math.abs(best.gap)) best = { e, gap };
    }
    return best;
  }, [all, polls]);

  const fresh = all.filter((e) => moves.get(keyOf(e.team))?.kind === "new");
  const cfpLive = all.some((e) => pollRanksFor(e.team, polls).cfp != null);

  const insights = [
    riser
      ? { label: "BIGGEST RISER", value: riser.e.team, aside: `▲ ${riser.places}`, note: `${riser.e.lastResult || riser.e.record}` }
      : null,
    split
      ? {
          label: "BIGGEST SPLIT WITH AP",
          value: split.e.team,
          aside: split.gap > 0 ? "we're higher" : "we're lower",
          note: `Pylon No. ${split.e.rank}, AP No. ${pollRanksFor(split.e.team, polls).ap} — ${Math.abs(split.gap)} spots apart`,
        }
      : null,
    {
      label: "NEW THIS WEEK",
      value: fresh.map((e) => e.team).join(", ") || "None",
      aside: fresh.length ? `${fresh.length} IN` : "",
      note: dropped.length ? `${dropped.length} out: ${dropped.map((e) => e.team).join(", ")}` : "Nobody dropped out",
    },
  ].filter((x): x is { label: string; value: string; aside: string; note: string } => x != null);

  return (
    <>
      {insights.length ? <Insights items={insights} /> : null}
      <FilterChips
        options={[{ label: "All", count: all.length }, ...confs.map((c) => ({ label: c, count: all.filter((e) => e.conference === c).length }))]}
        filter={filter}
        setFilter={setFilter}
        showing={vis.length}
        total={all.length}
      />
      <div style={{ marginTop: 16, overflowX: "auto", ...glass("sheet") }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px 42px 32px minmax(0,1fr) 46px 80px minmax(160px,220px)", gap: 12, alignItems: "center", padding: "11px 16px", fontSize: 10, letterSpacing: ".16em", color: C.neutral500, ...hairline }}>
            <span style={{ color: C.accent300 }}>PYLON</span>
            <span>CHG</span>
            <span />
            <span>TEAM</span>
            <span style={{ textAlign: "right" }}>REC</span>
            <span>4-WK</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, letterSpacing: ".1em" }}>
              <Legend color={C.accent} shape="dot" label="PYLON" />
              <Legend color={C.neutral200} shape="ring" label="AP" />
              <Legend color={C.neutral400} shape="diamond" label="COACHES" />
              <Legend color={C.accent200} shape="bar" label="CFP" />
            </span>
          </div>
          {vis.length === 0 ? (
            <div style={{ padding: "30px 16px", fontSize: 13, color: C.neutral400 }}>Nothing matches that filter.</div>
          ) : (
            vis.map((e, i) => (
              <CfbRow key={`${e.rank}-${e.team}`} entry={e} first={i === 0} move={moves.get(keyOf(e.team))} polls={polls} trail={history[keyOf(e.team)] ?? []} />
            ))
          )}
        </div>
      </div>
      <Footnotes
        items={[
          dropped.length ? { label: "DROPPED OUT", text: dropped.map((e) => e.team).join(", ") } : null,
          {
            label: "CFP",
            text: cfpLive ? "Committee rankings as of the latest release." : "The committee hasn't released its first ranking yet; the column fills in from there.",
          },
          { label: "CONSENSUS", text: "Each strip runs No. 1 to unranked. The shaded span is the spread between polls; ±4 or more lights up. Unranked marks sit faded at the right edge." },
        ].filter((x): x is { label: string; text: string } => x != null)}
      />
    </>
  );
}

function Legend({ color, shape, label }: { color: string; shape: "dot" | "ring" | "diamond" | "bar"; label: string }) {
  const mark =
    shape === "dot" ? (
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}` }} />
    ) : shape === "ring" ? (
      <span style={{ width: 6, height: 6, borderRadius: "50%", border: `1.5px solid ${color}` }} />
    ) : shape === "diamond" ? (
      <span style={{ width: 5, height: 5, transform: "rotate(45deg)", background: color }} />
    ) : (
      <span style={{ width: 6, height: 2, background: color }} />
    );
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {mark}
      {label}
    </span>
  );
}

const NR = 26;
const at = (v: number | null) => `${((Math.min(v ?? NR, NR) - 1) / (NR - 1)) * 100}%`;

function CfbRow({ entry, first, move, polls, trail }: { entry: Entry; first: boolean; move: Move | undefined; polls: Polls; trail: (number | null)[] }) {
  const ranks = pollRanksFor(entry.team, polls);
  const allRanks = [entry.rank, ranks.ap, ranks.coaches, ...(ranks.cfp != null ? [ranks.cfp] : [])].map((v) => v ?? NR);
  const lo = Math.min(...allRanks);
  const hi = Math.max(...allRanks);
  const gap = hi - lo;

  const tr = rankTrail(trail, 25);
  const fields = sparkFields(tr, 1, 26, true, tr[0] - tr[3]);

  const dots: { title: string; left: string; style: React.CSSProperties }[] = [
    { title: `AP ${ranks.ap ?? "NR"}`, left: at(ranks.ap), style: { width: 9, height: 9, borderRadius: "50%", border: `1.5px solid ${C.neutral200}`, background: C.bg, opacity: ranks.ap == null ? 0.35 : 1 } },
    { title: `Coaches ${ranks.coaches ?? "NR"}`, left: at(ranks.coaches), style: { width: 7, height: 7, transform: "translate(-50%,-50%) rotate(45deg)", background: C.neutral400, opacity: ranks.coaches == null ? 0.35 : 1 } },
    { title: `Pylon ${entry.rank}`, left: at(entry.rank), style: { width: 11, height: 11, borderRadius: "50%", background: C.accent, boxShadow: `0 0 0 3px rgb(var(--accent-rgb) / .22), 0 0 10px ${C.accent}` } },
  ];
  if (ranks.cfp != null) {
    dots.push({ title: `CFP ${ranks.cfp}`, left: at(ranks.cfp), style: { width: 9, height: 3, background: C.accent200 } });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "56px 42px 32px minmax(0,1fr) 46px 80px minmax(160px,220px)",
        gap: 12,
        alignItems: "center",
        padding: "10px 16px",
        ...(first ? {} : hairline),
      }}
    >
      <RankNumeral rank={entry.rank} max={25} />
      <ChangeChip move={move} />
      <LogoTile abbr={entry.abbr} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.team}</div>
        <div style={{ fontSize: 11, color: C.neutral500, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[entry.conference, entry.lastResult].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span style={{ fontSize: 13, textAlign: "right" }}>{entry.record}</span>
      <Sparkline fields={fields} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div style={{ position: "relative", height: 20, flex: 1, minWidth: 0 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 9, height: 2, borderRadius: 1, background: "rgb(var(--accent-rgb) / .14)" }} />
          <div
            style={{
              position: "absolute",
              top: 8,
              height: 4,
              borderRadius: 2,
              background: `rgb(var(--accent-rgb) / ${gap >= 4 ? 0.38 : 0.18})`,
              left: at(lo),
              width: `calc(${at(hi)} - ${at(lo)})`,
            }}
          />
          {dots.map((d, i) => (
            <span key={i} title={d.title} style={{ position: "absolute", top: 10, left: d.left, transform: d.style.transform ?? "translate(-50%,-50%)", ...d.style }} />
          ))}
        </div>
        <span style={{ flex: "0 0 auto", width: 38, textAlign: "right", fontSize: 11, letterSpacing: ".06em", color: gap >= 4 ? C.accent200 : C.neutral500 }}>
          {gap === 0 ? "AGREE" : `±${gap}`}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ NFL ---

function NflBoard({ nfl, moves, history, filter, setFilter }: {
  nfl: BoardReport;
  moves: Map<string, Move>;
  history: Record<string, (number | null)[]>;
  filter: string;
  setFilter: (f: string) => void;
}) {
  const all = nfl.ranked;
  const vis = filter === "All" ? all : all.filter((e) => nflMeta(e.team).division.startsWith(filter));

  const withMove = all.map((e) => ({ e, m: moves.get(keyOf(e.team)) }));
  const movers = withMove.filter((x): x is { e: Entry; m: Extract<Move, { kind: "up" | "down" }> } => x.m?.kind === "up" || x.m?.kind === "down");
  const riser = movers.filter((x) => x.m.kind === "up").sort((a, z) => z.m.places - a.m.places)[0];
  const faller = movers.filter((x) => x.m.kind === "down").sort((a, z) => z.m.places - a.m.places)[0];
  const unbeaten = all.filter((e) => /-0(-|$)/.test(e.record) && e.record !== "0-0");

  const insights = [
    riser ? { label: "BIGGEST RISER", value: riser.e.team, aside: `▲ ${riser.m.places}`, note: `${riser.e.lastResult || riser.e.record}` } : null,
    faller ? { label: "BIGGEST FALLER", value: faller.e.team, aside: `▼ ${faller.m.places}`, note: `${faller.e.lastResult || faller.e.record}` } : null,
    {
      label: unbeaten.length ? "UNBEATEN" : "TOP RECORD",
      value: (unbeaten.length ? unbeaten : all.slice(0, 1)).map((e) => e.team).join(", ") || "—",
      aside: (unbeaten[0] ?? all[0])?.record ?? "",
      note: unbeaten.length === 1 ? "The last unbeaten team in the league" : `${unbeaten.length} teams without a loss`,
    },
  ].filter((x): x is { label: string; value: string; aside: string; note: string } => x != null);

  return (
    <>
      {insights.length ? <Insights items={insights} /> : null}
      <FilterChips
        options={["All", "AFC", "NFC"].map((c) => ({ label: c, count: c === "All" ? all.length : all.filter((e) => nflMeta(e.team).division.startsWith(c)).length }))}
        filter={filter}
        setFilter={setFilter}
        showing={vis.length}
        total={all.length}
      />
      <div style={{ marginTop: 16, overflowX: "auto", ...glass("sheet") }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px 42px 32px minmax(0,1fr) minmax(0,110px) 46px 80px", gap: 12, alignItems: "center", padding: "11px 16px", fontSize: 10, letterSpacing: ".16em", color: C.neutral500, ...hairline }}>
            <span style={{ color: C.accent300 }}>RK</span>
            <span>CHG</span>
            <span />
            <span>TEAM</span>
            <span>DIVISION</span>
            <span style={{ textAlign: "right" }}>REC</span>
            <span>4-WK</span>
          </div>
          {vis.length === 0 ? (
            <div style={{ padding: "30px 16px", fontSize: 13, color: C.neutral400 }}>Nothing matches that filter.</div>
          ) : (
            vis.map((e, i) => {
              const meta = nflMeta(e.team);
              const tr = rankTrail(history[keyOf(e.team)] ?? [], 32);
              const fields = sparkFields(tr, 1, 32, true, tr[0] - tr[3]);
              return (
                <div
                  key={`${e.rank}-${e.team}`}
                  style={{ display: "grid", gridTemplateColumns: "56px 42px 32px minmax(0,1fr) minmax(0,110px) 46px 80px", gap: 12, alignItems: "center", padding: "10px 16px", ...(i === 0 ? {} : hairline) }}
                >
                  <RankNumeral rank={e.rank} max={32} />
                  <ChangeChip move={moves.get(keyOf(e.team))} />
                  <LogoTile abbr={meta.abbr} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.team}</div>
                    {e.lastResult ? <div style={{ fontSize: 11, color: C.neutral500, marginTop: 3 }}>{e.lastResult}</div> : null}
                  </div>
                  <span style={{ fontSize: 12, color: C.neutral400, whiteSpace: "nowrap" }}>{meta.division}</span>
                  <span style={{ fontSize: 13, textAlign: "right" }}>{e.record}</span>
                  <Sparkline fields={fields} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ P50 ---

function P50Board({ entries, before, history, week, filter, setFilter }: {
  entries: ProspectEntry[];
  before: ProspectBoard | null;
  history: Record<string, (number | null)[]>;
  week: number | null;
  filter: string;
  setFilter: (f: string) => void;
}) {
  const order = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DT", "LB", "CB", "S"];
  const positions = order.filter((o) => entries.some((e) => e.position === o));
  const vis = filter === "All" ? entries : entries.filter((e) => e.position === filter);

  const moves = useMemo(() => {
    const out = new Map<string, Move>();
    if (!before) return out;
    const was = new Map([...before.ranked, ...before.honorable].map((e) => [keyOf(e.player), e.rank]));
    for (const e of entries) {
      const then = was.get(keyOf(e.player));
      if (then == null) out.set(keyOf(e.player), { kind: "new" });
      else if (then === e.rank) out.set(keyOf(e.player), { kind: "held" });
      else if (then > e.rank) out.set(keyOf(e.player), { kind: "up", places: then - e.rank });
      else out.set(keyOf(e.player), { kind: "down", places: e.rank - then });
    }
    return out;
  }, [entries, before]);

  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.position] = (counts[e.position] ?? 0) + 1;
  const deepest = Object.keys(counts).sort((a, z) => counts[z] - counts[a])[0];

  const bySchool: Record<string, number> = {};
  for (const e of entries) bySchool[e.schoolAbbr] = (bySchool[e.schoolAbbr] ?? 0) + 1;
  const topSchool = Object.keys(bySchool).sort((a, z) => bySchool[z] - bySchool[a])[0];
  const blueChips = entries.filter((e) => e.rating >= 95).length;

  const top = entries[0];
  const insights = top
    ? [
        { label: "NO. 1 OVERALL", value: top.player, aside: top.rating.toFixed(1), note: `${top.position} · ${top.schoolAbbr}` },
        { label: "DEEPEST POSITION", value: deepest ?? "—", aside: deepest ? `${counts[deepest]} of ${entries.length}` : "", note: `${blueChips} blue-chip prospects across the class` },
        { label: "MOST PROSPECTS", value: topSchool ?? "—", aside: topSchool ? `${bySchool[topSchool]} players` : "", note: entries.filter((e) => e.schoolAbbr === topSchool).map((e) => e.position).join(", ") },
      ]
    : [];

  let lastTier: string | null = null;

  return (
    <>
      {insights.length ? <Insights items={insights} /> : null}
      <FilterChips
        options={[{ label: "All", count: entries.length }, ...positions.map((p) => ({ label: p, count: counts[p] }))]}
        filter={filter}
        setFilter={setFilter}
        showing={vis.length}
        total={entries.length}
      />
      <div style={{ marginTop: 16, overflowX: "auto", ...glass("sheet") }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px 32px minmax(0,1fr) 50px 80px 80px minmax(0,120px)", gap: 12, alignItems: "center", padding: "11px 16px", fontSize: 10, letterSpacing: ".16em", color: C.neutral500, ...hairline }}>
            <span style={{ color: C.accent300 }}>RK</span>
            <span />
            <span>PLAYER</span>
            <span>POS</span>
            <span>SCHOOL</span>
            <span>TREND</span>
            <span style={{ textAlign: "right" }}>PYLON RATING</span>
          </div>
          {vis.length === 0 ? (
            <div style={{ padding: "30px 16px", fontSize: 13, color: C.neutral400 }}>Nothing matches that filter.</div>
          ) : (
            vis.map((e, i) => {
              const tier = tierOf(e.rating);
              const showTier = filter === "All" && tier.name !== lastTier;
              lastTier = tier.name;
              const known = (history[keyOf(e.player)] ?? []).filter((v): v is number => v != null);
              const tr = ratingTrail(known.length ? known : [e.rating]);
              const fields = sparkFields(tr, Math.min(...tr) - 0.4, Math.max(...tr) + 0.4, false, tr[3] - tr[0]);
              return (
                <div key={`${e.rank}-${e.player}`}>
                  {showTier ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "22px 16px 8px" }}>
                      <span style={{ fontSize: 11, fontStyle: "italic", fontWeight: 500, letterSpacing: ".14em", color: C.accent200, flex: "0 0 auto" }}>{tier.name}</span>
                      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${C.accent700},transparent)` }} />
                      <span style={{ fontSize: 11, color: C.neutral500, flex: "0 0 auto" }}>{tier.range}</span>
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "56px 32px minmax(0,1fr) 50px 80px 80px minmax(0,120px)", gap: 12, alignItems: "center", padding: "10px 16px", ...(showTier || i === 0 ? {} : hairline) }}>
                    <RankNumeral rank={e.rank} max={50} />
                    <LogoTile abbr={e.schoolAbbr} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.player}</div>
                      <div style={{ fontSize: 11, color: C.neutral500, marginTop: 3 }}>
                        <ChangeChip move={moves.get(keyOf(e.player))} />
                      </div>
                    </div>
                    <span style={{ justifySelf: "start", fontSize: 11, letterSpacing: ".08em", padding: "2px 6px", borderRadius: 2, color: C.accent200, background: "rgb(var(--accent-rgb) / .14)" }}>
                      {e.position}
                    </span>
                    <span style={{ fontSize: 12, color: C.neutral400 }}>{e.schoolAbbr}</span>
                    <Sparkline fields={fields} />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                      <div style={{ flex: 1, maxWidth: 60, height: 3, borderRadius: 1, background: "rgb(var(--accent-rgb) / .08)", overflow: "hidden" }}>
                        <div style={{ height: "100%", background: C.accent, width: `${Math.max(4, ((e.rating - 75) / 25) * 100)}%` }} />
                      </div>
                      <span style={{ fontSize: 18, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.03em", color: C.accent200, width: 46, textAlign: "right" }}>
                        {e.rating.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <Footnotes
        items={[
          { label: "WEEK", text: week != null ? `Through week ${week}.` : "Not published yet." },
          { label: "NOTE", text: "Pylon Rating runs 0–100. Trend lines show recent updates to the rating." },
        ]}
      />
    </>
  );
}
