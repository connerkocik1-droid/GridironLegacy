"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Skeleton from "./Skeleton";
import TeamCrest from "./TeamCrest";
import TeamSettings from "./TeamSettings";
import MatchupBoard from "./MatchupBoard";
import WatchlistBoard from "./WatchlistBoard";
import TradeDesk from "./TradeDesk";
import MyTeamNews from "./MyTeamNews";
import MyTeamRoster from "./MyTeamRoster";
import { useMe } from "@/lib/use-me";
import { useRefreshable } from "@/lib/use-refresh";
import { optimalLineup } from "@/lib/start-rate";
import { proj, type LeagueShape } from "@/lib/roster";

/**
 * Everything that is yours, on one screen.
 *
 * This was six buttons leading to six pages. A table of contents is a
 * reasonable thing for a website and a poor one for something kept on a home
 * screen and opened for ninety seconds at a time: every answer was two taps
 * and a page load away, and the roster — the thing anybody actually opens this
 * for — was behind the same button as the PIN form.
 *
 * So the six become sections of one screen behind a strip of sub-tabs, and the
 * header above them carries the four numbers that were previously scattered
 * across three of the pages. The pages themselves stay where they are: they
 * are linked from the wire, from the standings, from a notice, and a link that
 * stops working is worse than a page nobody visits.
 *
 * Which sub-tab is showing lives in the address, so the back button steps
 * through them and a link to somebody's own trade desk still arrives at it.
 */

const TABS = ["Roster", "Matchup", "News", "Watch", "Trades", "Edit"] as const;
type Tab = (typeof TABS)[number];

function slugOf(tab: Tab): string {
  return tab.toLowerCase();
}

function tabFrom(slug: string | null): Tab {
  return TABS.find((t) => slugOf(t) === slug) ?? "Roster";
}

interface Feed {
  week: number;
  settings: LeagueShape | null;
  roster: string[];
  injuredReserve: string[];
  started: boolean;
  scores: Record<string, { points: number; statLine: string }>;
}

interface Standing {
  record: string | null;
  pointsFor: number | null;
}

/**
 * The micro-labels under each number.
 *
 * The design draws these at eight pixels. Eight pixels is below what the
 * mobile audit will pass and below what most people can read on a phone held
 * at arm's length, so they are ten here, with the tracking kept — the tracking
 * is what makes them read as labels rather than as small text.
 */
const MICRO: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".14em",
  color: "var(--text-dim)",
  marginTop: 3,
};

/** Fades only the edges that have something behind them. */
function edgeFade({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (!left && !right) return undefined;
  const from = left ? "transparent 0,#000 26px" : "#000 0";
  const to = right ? "#000 calc(100% - 26px),transparent 100%" : "#000 100%";
  return `linear-gradient(90deg,${from},${to})`;
}

export default function MyTeamBoard() {
  return (
    // The tab lives in the query string, which needs a boundary.
    <Suspense fallback={<Skeleton rows={6} />}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabFrom(params.get("tab"));

  const [feed, setFeed] = useState<Feed | null>(null);
  const [standing, setStanding] = useState<Standing>({ record: null, pointsFor: null });

  // Where the top of the screen actually is. The nav above this is sticky too
  // and wraps to two rows on a narrow phone, so its height is not a constant
  // to hard-code — a wrong guess either leaves a gap the page shows through or
  // parks the sub-tabs underneath the wordmark, where they cannot be pressed.
  const [navHeight, setNavHeight] = useState(0);
  // Which edges of the sub-tab strip have more behind them. A fade drawn at a
  // fixed edge dims whatever happens to be there, which on the last tab is the
  // one you just pressed.
  const [strip, setStrip] = useState({ left: false, right: false });
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);

  const measureStrip = useCallback(() => {
    if (!stripEl) return;
    const room = stripEl.scrollWidth - stripEl.clientWidth;
    setStrip({ left: stripEl.scrollLeft > 2, right: stripEl.scrollLeft < room - 2 });
  }, [stripEl]);

  useEffect(() => {
    if (!stripEl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measureStrip();

    // The pressed tab is brought into view, so pressing the one half off the
    // edge does not leave it half off the edge.
    stripEl
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });

    const observer = new ResizeObserver(measureStrip);
    observer.observe(stripEl);
    return () => observer.disconnect();
  }, [stripEl, measureStrip, tab]);

  useEffect(() => {
    const nav = document.querySelector(".gl-nav");
    if (!nav) return;
    const measure = () => setNavHeight(nav.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    // Two requests for four numbers, and a failure in either costs a number
    // rather than the screen. The roster below draws its own copy of the
    // lineup feed; this one is only for the header.
    const [lineup, home] = await Promise.all([
      fetch("/api/lineup", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/home", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (lineup) setFeed(lineup as Feed);

    // Before anything has been graded a record is not 0-0, it is a season that
    // has not started. The home feed says which by `played`.
    const row = home?.played
      ? home.power?.find((r: { mine?: boolean }) => r.mine)
      : null;
    setStanding({
      record: row ? `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}` : null,
      pointsFor: row ? Number(row.pointsFor) : null,
    });
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * What this roster is worth this week, and whether that is a score yet.
   *
   * A nought before anything has been played is not a score, it is a week that
   * has not happened — and the two are told apart by whether the league has
   * written down a single number, not by whether the week is flagged as begun.
   * The flag turns over when the first fixture is due; the scores arrive when
   * somebody actually plays. In the hours between, this said "0.0 SCORED" over
   * a full roster, which reads as a catastrophe rather than as a Sunday
   * morning.
   */
  const tally = useMemo(() => {
    const roster = feed?.roster ?? [];
    if (!roster.length) return null;

    // Recorded at all, rather than recorded as nought: a man who has taken the
    // field and not scored is a real nought and belongs in the total, while a
    // week with nothing written down at all has not happened yet.
    const recorded = roster.some((name) => feed?.scores?.[name] != null);
    const live = Boolean(feed?.started) && recorded;

    // The basis first, then the lineup from it. This is the whole of the bug
    // this replaces: the lineup was chosen by projection and the live points
    // were then summed over whoever projection had picked. Best ball does not
    // work that way — the slots fill with whoever is actually scoring. On a
    // Thursday night, when one man on the roster has played and he is not in
    // the projected eleven, that arithmetic returns nought over a roster that
    // has six points on the board.
    const values = new Map<string, number>(
      roster.map((name) => [name, live ? (feed?.scores?.[name]?.points ?? 0) : proj(name)]),
    );

    const slots = optimalLineup(roster, feed?.settings ?? null, values);

    let total = 0;
    for (const name of slots.keys()) total += values.get(name) ?? 0;
    return { value: total, scored: live };
  }, [feed]);

  const manager = me.status === "signed-in" ? me.manager : null;

  const go = (next: Tab) => {
    const query = next === "Roster" ? "" : `?tab=${slugOf(next)}`;
    router.push(`/my-team${query}`, { scroll: false });
  };

  if (me.status === "checking") {
    return <Skeleton rows={6} />;
  }

  if (!manager) {
    return (
      <div
        style={{
          maxWidth: 560,
          margin: "60px auto",
          padding: "0 18px",
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        Sign in to see your team.
      </div>
    );
  }

  const onRoster = (feed?.roster.length ?? 0) + (feed?.injuredReserve.length ?? 0);

  const stats: { value: string; label: string; accent?: boolean }[] = [
    {
      value: tally == null ? "—" : tally.value.toFixed(1),
      label: tally?.scored ? "SCORED" : "PROJECTED",
      accent: true,
    },
    { value: onRoster ? String(onRoster) : "—", label: "ON ROSTER" },
    { value: standing.record ?? "—", label: "RECORD" },
    { value: standing.pointsFor == null ? "—" : standing.pointsFor.toFixed(1), label: "POINTS FOR" },
  ];

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* Sticky, because the sub-tab strip is the navigation for this screen
          and a roster is longer than a phone. The blur and the fade at the
          bottom edge are what stop the rows from appearing to collide with it. */}
      <div
        style={{
          position: "sticky",
          top: navHeight,
          // Under the nav rather than over it: the wordmark and the profile
          // button have to stay reachable from every screen.
          zIndex: 10,
          padding: "18px 18px 0",
          // The page's own ground, not a fixed dark one: the mockup is dark
          // only, and a hard-coded scrim here painted a black band across the
          // light theme with the franchise name invisible inside it.
          background:
            "linear-gradient(180deg,rgb(var(--bg-rgb) / .96) 84%,rgb(var(--bg-rgb) / 0))",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <TeamCrest franchise={manager.franchise} logo={manager.logo} size={44} shape="box" />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 21,
                lineHeight: 1.15,
                letterSpacing: "-.025em",
                marginTop: 3,
                color: "var(--text)",
                overflowWrap: "anywhere",
              }}
            >
              {manager.franchise}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
              {manager.name}
            </div>
          </div>

          <button
            type="button"
            onClick={() => go("Edit")}
            aria-label="Edit team"
            style={{
              cursor: "pointer",
              flex: "0 0 auto",
              width: 34,
              height: 34,
              borderRadius: 9,
              border: "1px solid rgb(var(--accent-rgb) / .34)",
              background: "transparent",
              color: "var(--accent-link)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
              <path d="m227.3 73.4-44.7-44.7a16 16 0 0 0-22.6 0l-120 120A15.9 15.9 0 0 0 35.3 160v44.7a16 16 0 0 0 16 16H96a15.9 15.9 0 0 0 11.3-4.7l120-120a16 16 0 0 0 0-22.6ZM92.7 204.7H51.3V163.3l84-84 41.4 41.4Z" />
            </svg>
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 8,
            marginTop: 14,
          }}
        >
          {stats.map((s) => (
            <div key={s.label}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 19,
                  lineHeight: 1,
                  color: s.accent ? "var(--accent-link)" : "var(--text)",
                }}
              >
                {s.value}
              </div>
              <div style={MICRO}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Six labels do not fit across a phone, so the strip scrolls. It is
            pulled out to the page edges and faded on the right, because a
            strip cut off flush against a gutter reads as a strip that is
            broken rather than one with more in it. */}
        <div
          role="tablist"
          aria-label="My team sections"
          className="gl-noscrollbar"
          ref={setStripEl}
          onScroll={measureStrip}
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            margin: "14px -18px 0",
            padding: "0 18px 1px",
            // The width of the fade, so scrolling a tab into view puts it
            // clear of the fade rather than underneath it.
            scrollPaddingInline: 26,
            maskImage: edgeFade(strip),
            WebkitMaskImage: edgeFade(strip),
          }}
        >
          {TABS.map((t) => {
            const on = t === tab;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go(t)}
                style={{
                  cursor: "pointer",
                  flex: "0 0 auto",
                  fontFamily: "inherit",
                  fontSize: 12,
                  letterSpacing: ".06em",
                  // Tall enough to press: the design's 8px padding makes a
                  // 27px target, which is under the floor for a thumb.
                  minHeight: 36,
                  padding: "8px 11px",
                  borderRadius: "8px 8px 0 0",
                  border: 0,
                  background: on ? "rgb(var(--accent-rgb) / .18)" : "transparent",
                  color: on ? "var(--text)" : "var(--text-dim)",
                  boxShadow: on ? "inset 0 -2px 0 var(--accent-link)" : "none",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div style={{ height: 1, background: "rgb(var(--accent-rgb) / .2)", margin: "0 -18px" }} />
      </div>

      <div style={{ padding: "14px 0 24px" }}>
        {tab === "Roster" ? <MyTeamRoster /> : null}
        {tab === "Matchup" ? <MatchupBoard embedded /> : null}
        {tab === "News" ? <MyTeamNews /> : null}
        {tab === "Watch" ? <WatchlistBoard embedded /> : null}
        {tab === "Trades" ? (
          <div style={{ padding: "0 18px" }}>
            <TradeDesk />
          </div>
        ) : null}
        {tab === "Edit" ? (
          <div style={{ padding: "0 18px" }}>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--text-muted)",
                lineHeight: 1.65,
                margin: "0 0 14px",
              }}
            >
              Your franchise&rsquo;s name and picture are what the rest of the league sees
              beside your score. Your PIN is only yours.
            </p>
            <div
              style={{
                border: "1px solid rgb(var(--accent-rgb) / .22)",
                borderRadius: "var(--radius-lg)",
                background: "rgb(var(--surface-rgb) / .55)",
                overflow: "hidden",
                paddingTop: 2,
              }}
            >
              <TeamSettings manager={manager} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
