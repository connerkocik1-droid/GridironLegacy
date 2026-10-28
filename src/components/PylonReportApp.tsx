"use client";

import { useState } from "react";
import Link from "next/link";
import { keyOf, movement, nflMeta, pollRanksFor, type BoardReport, type Move, type Polls } from "@/lib/pylon-report";
import { byRating, prospectMovement, TIERS, tierOf, type ProspectBoard } from "@/lib/pylon-draft-board";
import { rankTrail, ratingTrail } from "@/lib/pylon-report-view";
import { useRetro } from "@/lib/retro";
import { teamLogoPx } from "@/lib/team-logo";
import { cfbLogo, cfbSchool } from "@/lib/cfb-logos";
import BoardMark from "./BoardMark";
import { AppView, Chips, Foot, Note, RowGroup, tileStyle, type Movement, type RowSpec } from "./RowList";

type Board = "CFB Top 25" | "NFL Power 32" | "Pylon 50";

interface Props {
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
  cfbLogos: Record<string, string>;
  nflLogos: Record<string, string>;
}

const chg = (m: Move | undefined): Movement | undefined =>
  !m
    ? undefined
    : m.kind === "new"
      ? { tone: "new", label: "NEW" }
      : m.kind === "held"
        ? { tone: "flat", label: "—" }
        : { tone: m.kind, label: `${m.kind === "up" ? "▲" : "▼"}${m.places}` };

/** A logo, or the abbreviation in a tile (a pixel mark in 16-bit). */
function Mark({ abbr, src }: { abbr: string; src?: string }) {
  const retro = useRetro();
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={24} height={24} style={{ width: 24, height: 24, objectFit: "contain", flex: "0 0 auto" }} />;
  if (retro)
    return <span aria-hidden style={{ width: 24, height: 24, flex: "0 0 auto", background: `${teamLogoPx(abbr, abbr)} center / contain no-repeat`, imageRendering: "pixelated" }} />;
  return <span style={tileStyle(false)}>{abbr}</span>;
}

/**
 * Rankings → Pylon Report, inside the app: the commissioner's three boards
 * behind one chip strip — the CFB Top 25 with AP alongside, the NFL's 32 by
 * division, and the Pylon 50 big board in rating tiers — each with movement
 * since last week and a four-week trail from the boards actually published.
 * From the Pylon Report view in prototype/Pylon App.dc.html. The full web
 * edition of the report (PylonReportPage) is what a desktop browser gets.
 */
export default function PylonReportApp(p: Props) {
  const [board, setBoard] = useState<Board>("CFB Top 25");

  const empty =
    board === "Pylon 50" ? !p.bigBoard.ranked.length : board === "CFB Top 25" ? !p.college.ranked.length : !p.nfl.ranked.length;

  let body: React.ReactNode = null;
  if (empty) {
    body = <Note tag="NOT YET">Nothing published yet. Check back once the commissioner puts this week&apos;s boards up.</Note>;
  } else if (board === "CFB Top 25") {
    const moves = movement(p.college, p.collegeBefore);
    const rows: RowSpec[] = p.college.ranked.map((e, i) => {
      const ap = pollRanksFor(e.team, p.polls).ap;
      const abbr = e.abbr || cfbSchool(e.team)?.abbr || "";
      return {
        key: keyOf(e.team),
        num: e.rank,
        lit: i < 5,
        chg: chg(moves.get(keyOf(e.team))),
        logo: <Mark abbr={abbr} src={p.cfbLogos[abbr] ?? cfbLogo(abbr, e.team)} />,
        title: e.team,
        sub: [e.conference, p.polls.ap.length ? `AP ${ap ?? "NR"}` : null, e.lastResult || null].filter(Boolean).join(" · "),
        spark: rankTrail(p.collegeHistory[keyOf(e.team)] ?? [], 25),
        sparkRank: true,
        val: e.record || undefined,
        tight: true,
      };
    });
    body = <RowGroup label={`WEEK ${p.week ?? ""} · PYLON ORDER`} note={`${rows.length} teams`} rows={rows} limit={12} />;
  } else if (board === "NFL Power 32") {
    const moves = movement(p.nfl, p.nflBefore);
    const rows: RowSpec[] = p.nfl.ranked.map((e, i) => {
      const meta = nflMeta(e.team);
      return {
        key: keyOf(e.team),
        num: e.rank,
        lit: i < 5,
        chg: chg(moves.get(keyOf(e.team))),
        logo: p.nflLogos[meta.abbr] ? <Mark abbr={meta.abbr} src={p.nflLogos[meta.abbr]} /> : <BoardMark team={e.team} size={24} />,
        title: e.team,
        sub: [meta.division, e.lastResult || null].filter(Boolean).join(" · "),
        spark: rankTrail(p.nflHistory[keyOf(e.team)] ?? [], 32),
        sparkRank: true,
        val: e.record || undefined,
        tight: true,
      };
    });
    body = <RowGroup label={`WEEK ${p.week ?? ""}`} note={`${rows.length} teams`} rows={rows} limit={12} />;
  } else {
    const ranked = byRating(p.bigBoard.ranked);
    const moves = prospectMovement(p.bigBoard, p.bigBoardBefore);
    const school = (abbr: string) => p.college.ranked.find((e) => e.abbr === abbr)?.team ?? cfbSchool(abbr)?.name ?? abbr;
    const seen: Record<string, number> = {};
    const all = ranked.map((e) => ({ e, pr: (seen[e.position] = (seen[e.position] ?? 0) + 1) }));
    body = (
      <>
        {TIERS.map((tier) => {
          const rows: RowSpec[] = all
            .filter(({ e }) => tierOf(e.rating).name === tier.name)
            .map(({ e, pr }) => {
              const known = (p.bigBoardHistory[keyOf(e.player)] ?? []).filter((v): v is number => v != null);
              return {
                key: keyOf(e.player),
                num: e.rank,
                lit: e.rank <= 5,
                chg: chg(moves.get(keyOf(e.player))),
                logo: <Mark abbr={e.schoolAbbr} src={p.cfbLogos[e.schoolAbbr] ?? cfbLogo(e.schoolAbbr)} />,
                title: e.player,
                tags: [{ label: e.position, tone: "flat" as const }],
                sub: `${school(e.schoolAbbr)} · ${e.position}${pr} in class`,
                spark: known.length > 1 ? ratingTrail(known) : null,
                val: e.rating.toFixed(1),
                valSub: "PYLON",
                bigVal: true,
                valColor: "var(--ap-a200)",
                tight: true,
              };
            });
          return rows.length ? <RowGroup key={tier.name} label={tier.name} note={`${rows.length} prospects`} rows={rows} limit={8} /> : null;
        })}
        <Foot>2027 draft class, ordered by Pylon Rating (0–100).{p.bigBoardWeek ? ` Week ${p.bigBoardWeek} board.` : ""}</Foot>
      </>
    );
  }

  return (
    <AppView>
      <Chips options={["CFB Top 25", "NFL Power 32", "Pylon 50"] as Board[]} value={board} onChange={setBoard} label="Board" />
      {body}
      <Foot>
        <Link href="/pylon-report?view=web" style={{ color: "var(--ap-a300)" }}>
          Full report, with the polls and the week&apos;s takeaways →
        </Link>
      </Foot>
    </AppView>
  );
}
