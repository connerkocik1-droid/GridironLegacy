/**
 * The three doors the redesigned app opens through, each with its own
 * sub-tab strip underneath. Shared between the desktop `Nav` and the
 * mobile `TabBar` so there is one map of "where things live" rather than
 * two that can drift apart.
 *
 * Ownership is by path prefix, the same "longest claim wins" rule the old
 * TabBar used for its fourth slot — so a nested route like `/player/x`
 * still lights up the tab that owns it.
 */

export interface SubTab {
  label: string;
  href: string;
  /** Paths this sub-tab answers for, beyond its own href. */
  owns?: string[];
}

export interface AppTab {
  id: "league" | "gm" | "rankings";
  label: string;
  /** The sub-tab a bare tap on the tab bar lands on. */
  href: string;
  subtabs: SubTab[];
}

export const APP_TABS: AppTab[] = [
  {
    id: "league",
    label: "The League",
    href: "/matchups",
    subtabs: [
      { label: "Roster", href: "/my-team", owns: ["/my-team", "/lineup"] },
      { label: "Matchup", href: "/matchups" },
      { label: "Around League", href: "/the-league", owns: ["/the-league", "/league", "/team", "/news", "/player-news", "/rules"] },
      { label: "Standings", href: "/standings" },
      { label: "GameCast", href: "/games", owns: ["/games", "/game"] },
    ],
  },
  {
    id: "gm",
    label: "General Manager",
    href: "/free-agents",
    subtabs: [
      { label: "Free Agency", href: "/free-agents" },
      { label: "Watchlist", href: "/watchlist" },
      { label: "Trades", href: "/trade-builder", owns: ["/trade-builder", "/trades"] },
      { label: "Transactions", href: "/activity" },
      { label: "Minigames", href: "/minigames", owns: ["/minigames", "/pickem", "/20-0"] },
    ],
  },
  {
    id: "rankings",
    label: "Rankings",
    href: "/league-power",
    subtabs: [
      { label: "League Power", href: "/league-power" },
      { label: "Pylon Report", href: "/pylon-report" },
      { label: "Players", href: "/rankings", owns: ["/rankings", "/players", "/player"] },
    ],
  },
];

function owns(pathname: string, owned: string): boolean {
  return owned === "/" ? pathname === "/" : pathname === owned || pathname.startsWith(`${owned}/`);
}

/** Which app tab a path belongs to, by longest matching claim. Null for
 * pages outside the three doors (the draft room, the commissioner's own
 * pages) — those are reachable but light up no tab. */
export function appTabFor(pathname: string): AppTab | null {
  let best: { tab: AppTab; length: number } | null = null;
  for (const tab of APP_TABS) {
    for (const sub of tab.subtabs) {
      const claims = [sub.href, ...(sub.owns ?? [])];
      for (const claim of claims) {
        if (owns(pathname, claim) && (!best || claim.length > best.length)) {
          best = { tab, length: claim.length };
        }
      }
    }
  }
  return best?.tab ?? null;
}

/** Which sub-tab of a tab a path belongs to, by the same longest-claim rule. */
export function subTabFor(tab: AppTab, pathname: string): SubTab | null {
  let best: { sub: SubTab; length: number } | null = null;
  for (const sub of tab.subtabs) {
    const claims = [sub.href, ...(sub.owns ?? [])];
    for (const claim of claims) {
      if (owns(pathname, claim) && (!best || claim.length > best.length)) {
        best = { sub, length: claim.length };
      }
    }
  }
  return best?.sub ?? null;
}
