"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import DraftSettings from "./DraftSettings";
import { readPickClock, type ClockTier } from "@/lib/draft-clock";
import NextSeason from "./NextSeason";
import RosterFix from "./RosterFix";
import SeasonRules from "./SeasonRules";
import IntroVideoSlot from "./IntroVideoSlot";

interface Manager {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  division: string | null;
  claimed: boolean;
  isCommissioner: boolean;
}

interface Admin {
  isCommissioner: boolean;
  league: {
    id: string;
    name: string;
    season: number;
    settings: {
      rounds?: number;
      /** What a league had before the clock was tiered: one number for the draft. */
      pickSeconds?: number;
      pickClock?: unknown;
      cinematicRounds?: number;
      introVideo?: string;
      regularWeeks?: number;
      tradeDeadlineWeek?: number;
      waiverDays?: number;
    };
    lottery_order?: string[] | null;
    draft_state: string;
    current_pick: number;
    draft_at: string | null;
  } | null;
  managers: Manager[];
  board: { picks: number; made: number };
  canResize: boolean;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  padding: "16px 18px",
  marginBottom: 16,
};

const numberField: React.CSSProperties = {
  width: 78,
  padding: "8px 10px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.3)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 14,
};

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

export default function Commissioner() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teams, setTeams] = useState("");
  const [rounds, setRounds] = useState("");
  const [draftAt, setDraftAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [releasing, setReleasing] = useState<Manager | null>(null);
  const [releaseFranchises, setReleaseFranchises] = useState(false);
  // Kept apart from the rest of the office: whether a season is finished is a
  // different question from how the league is configured, and asking for it
  // separately means the rest of this page still loads if it fails.
  const [season, setSeason] = useState<{ season: number; champion: string | null } | null>(null);

  const loadSeason = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/season", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      if (body.season != null) setSeason({ season: body.season, champion: body.champion ?? null });
    } catch {
      // The card simply does not appear. Nothing else on the page needs it.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/league", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in as the commissioner.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));

      const data: Admin = await res.json();
      setAdmin(data);
      setTeams(String(data.managers.length));
      setRounds(String(data.league?.settings?.rounds ?? 24));
      // datetime-local wants the browser's own wall clock, not an ISO string
      // in UTC, or the picker shows a time nobody chose.
      setDraftAt(
        data.league?.draft_at
          ? new Date(
              new Date(data.league.draft_at).getTime() -
                new Date().getTimezoneOffset() * 60_000,
            )
              .toISOString()
              .slice(0, 16)
          : "",
      );
      setError(null);
    } catch {
      setError("Could not load the league office.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadSeason();
  }, [load, loadSeason]);

  async function save() {
    if (busy || !admin) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teams: Number(teams), rounds: Number(rounds) }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "That change did not go through.");
      } else {
        setNotice("Saved. The draft board has been rebuilt to match.");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveDraftDate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // An empty box clears the date rather than saving a blank one.
        body: JSON.stringify({ draftAt: draftAt ? new Date(draftAt).toISOString() : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not save the draft date.");
      else setNotice(draftAt ? "Draft date saved. The countdown is live." : "Draft date cleared.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rollSeason() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/season", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not start the next season.");
      else
        setNotice(
          `The ${body.season} season is open. ${body.playersKept} players kept, ` +
            `${body.weeksRemoved} weeks cleared, ${body.rosterRowsSaved} roster rows photographed first.`,
        );
      await load();
      await loadSeason();
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(
    changes: Record<string, number | ClockTier[]>,
    what: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? `Could not save the ${what}.`);
      else setNotice(`${what[0].toUpperCase()}${what.slice(1)} saved.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveOrder(slots: string[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/draft/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: slots }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not set the draft order.");
      else setNotice(`Order set: ${slots.join(" · ")}. The board has been redrawn.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function buildSchedule() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/schedule", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not build the schedule.");
      else
        setNotice(
          `Schedule built: ${body.matchups} matchups over ${body.weeks} weeks` +
            (body.byes ? `, with ${body.byes} byes.` : "."),
        );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function moveDivision(manager: Manager, division: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/divisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerId: manager.id, division }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not move that franchise.");
      else setNotice(`${manager.franchise} is in the ${division}. Rebuild the schedule to apply it.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resetLeague() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/league/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseFranchises }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The league was not reset.");
      } else {
        setNotice(
          `League reset. ${body.playersReturned} players returned to the pool, ` +
            `${body.weeksRemoved} weeks of fixtures removed` +
            (body.franchisesReleased
              ? `, ${body.franchisesReleased} franchises released`
              : "") +
            (body.rosterRowsSaved
              ? `. The rosters were saved to backups first.`
              : ".") +
            " Build the schedule again when the divisions are settled.",
        );
        setReleaseFranchises(false);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function release(manager: Manager) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerId: manager.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not release that franchise.");
      } else {
        setNotice(
          `${body.was ?? "That manager"} has been let go. ${manager.franchise} keeps its name, ` +
            `its roster and its fixtures, and is open for somebody to claim at sign-in.`,
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function clearPin(manager: Manager) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/reset-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerId: manager.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not clear that PIN.");
      else setNotice(`${manager.franchise} can claim a new PIN at sign-in.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !admin) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!admin) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Opening the league office…</div>;
  }
  if (!admin.isCommissioner) {
    return (
      <div style={{ padding: "24px 26px", color: "#9397ab" }}>
        The league office is the commissioner&apos;s.
      </div>
    );
  }

  const claimed = admin.managers.filter((m) => m.claimed).length;

  // The two divisions actually in use, so a renamed pair still shows.
  const divisions = Array.from(
    new Set(admin.managers.map((m) => m.division).filter(Boolean) as string[]),
  ).sort();
  if (divisions.length < 2) divisions.push(...["East", "West"].filter((d) => !divisions.includes(d)));

  // Everyone once, then the divisional rematches: (n-1) + (largest division - 1).
  const perDivision = divisions.map(
    (d) => admin.managers.filter((m) => m.division === d).length,
  );
  const n = admin.managers.length;
  const seasonWeeks =
    (n % 2 === 1 ? n : n - 1) + Math.max(0, Math.max(...perDivision, 0) - 1);
  const changed =
    Number(teams) !== admin.managers.length ||
    Number(rounds) !== (admin.league?.settings?.rounds ?? 24);

  return (
    <div style={{ padding: "24px 26px 40px", maxWidth: 780 }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>LEAGUE OFFICE</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 20px",
          fontWeight: 500,
        }}
      >
        {admin.league?.name ?? "League"}
      </h1>

      <div style={{ marginBottom: 18 }}>
        <a
          href="/commissioner/preseason"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
            fontSize: 12,
            color: "#b5abfc",
            textDecoration: "none",
          }}
        >
          Check the scoring against preseason box scores →
        </a>
      </div>

      <OfficeMenu />

      {notice ? (
        <div style={{ fontSize: 12, color: "#7fd1a8", marginBottom: 14 }}>{notice}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 14 }}>{error}</div>
      ) : null}

      <div id="office-size" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>League size</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 14px" }}>
          {claimed} of {admin.managers.length} franchises claimed. Adding creates
          open franchises for people to claim; removing only ever takes away ones
          nobody has claimed and that hold no players. The draft board is rebuilt
          from these numbers, so it always matches the league.
        </p>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="teams" style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 6 }}>
              FRANCHISES
            </label>
            <input
              id="teams"
              value={teams}
              onChange={(e) => setTeams(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              disabled={!admin.canResize}
              style={{ ...numberField, opacity: admin.canResize ? 1 : 0.5 }}
            />
          </div>

          <div>
            <label htmlFor="rounds" style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 6 }}>
              ROUNDS
            </label>
            <input
              id="rounds"
              value={rounds}
              onChange={(e) => setRounds(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              disabled={!admin.canResize}
              style={{ ...numberField, opacity: admin.canResize ? 1 : 0.5 }}
            />
          </div>

          <button onClick={save} disabled={busy || !changed || !admin.canResize} style={action(!busy && changed && admin.canResize)}>
            Save &amp; rebuild board
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#75798c", marginTop: 12 }}>
          {admin.canResize
            ? `Board: ${admin.board.picks} picks.`
            : `The draft has started — ${admin.board.made} picks are in, so the size is fixed now.`}
        </div>
      </div>

      <div id="office-draft-day" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Draft day</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 14px" }}>
          What the countdown in the draft room counts to, in your own time zone.
          Reaching it does not open the room — you still do that, so a late
          arrival does not miss their pick.
        </p>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label
              htmlFor="draftAt"
              style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 6 }}
            >
              DATE AND TIME
            </label>
            <input
              id="draftAt"
              type="datetime-local"
              value={draftAt}
              onChange={(e) => setDraftAt(e.target.value)}
              style={{ ...numberField, width: 232 }}
            />
          </div>
          <button onClick={saveDraftDate} disabled={busy} style={action(!busy)}>
            Save
          </button>
        </div>

        <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "14px 0 0" }}>
          Before the night itself, walk through the reveal, the chime and the
          countdown at{" "}
          <a href="/draft/rehearsal" style={{ color: "#b5abfc" }}>
            /draft/rehearsal
          </a>
          . It drives the same screens without touching the league, and tells
          you whether the browser is blocking the chime — which is the failure
          worth finding early.
        </p>
      </div>

      <div id="office-draft-settings" style={card}>
        <DraftSettings
          pickClock={readPickClock(admin.league?.settings)}
          cinematicRounds={admin.league?.settings?.cinematicRounds ?? 3}
          order={admin.league?.lottery_order ?? null}
          managers={admin.managers}
          canChange={admin.canResize}
          busy={busy}
          onSave={(changes) => void saveSettings(changes, "draft settings")}
          onOrder={(slots) => void saveOrder(slots)}
        />
      </div>

      <div id="office-rosters" style={card}>
        <RosterFix />
      </div>

      {season ? (
        <div id="office-next-season" style={card}>
          <NextSeason
            season={season.season}
            champion={season.champion}
            busy={busy}
            onRoll={() => void rollSeason()}
          />
        </div>
      ) : null}

      <div id="office-rules" style={card}>
        <SeasonRules
          tradeDeadlineWeek={
            admin.league?.settings?.tradeDeadlineWeek ??
            Math.max(1, (admin.league?.settings?.regularWeeks ?? 13) - 2)
          }
          waiverDays={admin.league?.settings?.waiverDays ?? 1}
          regularWeeks={admin.league?.settings?.regularWeeks ?? 13}
          busy={busy}
          onSave={(changes) => void saveSettings(changes as Record<string, number>, "season rules")}
        />
      </div>

      <div id="office-intro" style={card}>
        <IntroVideoSlot
          introVideo={admin.league?.settings?.introVideo ?? null}
          onSaved={() => void load()}
        />
      </div>

      <div id="office-schedule" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Season schedule</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          Everyone plays everyone once, then divisional rivals meet a second
          time. That decides the season length rather than the other way round:
          {" "}
          <strong style={{ color: "#d2cefd", fontWeight: 500 }}>
            {seasonWeeks} weeks
          </strong>{" "}
          for {admin.managers.length} franchises. Build it once the divisions
          are settled — it cannot be rebuilt after a week has been played,
          because that would discard results that already stand.
        </p>
        <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 14px" }}>
          {seasonWeeks > 15
            ? "That is longer than an NFL regular season leaves room for once you add playoffs — consider fewer franchises, or divisional rivals once."
            : "That leaves room for playoffs inside an 18-week NFL season."}
        </p>
        <button onClick={buildSchedule} disabled={busy} style={action(!busy)}>
          Build schedule
        </button>
      </div>

      <div id="office-franchises" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Franchises and divisions</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          {divisions.join(" and ")} — {perDivision.join(" and ")} franchises.
          Moving a franchise takes effect when you rebuild the schedule, and is
          refused once a week has been played. Clearing a PIN does not set a new
          one — the manager chooses theirs at sign-in, so nobody can sign in as
          their team. Letting somebody go is the other thing: it hands the
          franchise back without removing it from the league.
        </p>

        {admin.managers.map((m) => (
          <div
            key={m.id}
            role="group"
            // Twelve rows of the same four controls. Without a label on each,
            // neither a screen reader nor anything else driving the page can
            // say which franchise a button belongs to.
            aria-label={m.franchise}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              // Four controls and two labels do not fit a phone on one line,
              // and every one of them is fixed-width, so without this the row
              // simply runs off the side. Only visible for a franchise that
              // has been claimed, which is why it survived the mobile pass.
              flexWrap: "wrap",
              rowGap: 6,
              padding: "9px 0",
              borderTop: "1px solid rgba(145,132,217,.12)",
            }}
          >
            <span style={{ fontSize: 10, color: "#75798c", width: 44, flex: "0 0 auto" }}>
              {m.slot}
            </span>
            {/* A floor, not just a share. The row wraps, and with a bare
                flex: 1 the name took whatever the fixed-width controls left —
                at 320px that was four pixels and a franchise spelled downwards.
                Given a basis, it pushes the division buttons onto the next
                line instead and keeps the name readable. */}
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, minWidth: 0, flex: "1 1 140px" }}>
              {m.franchise}
              {m.isCommissioner ? (
                <span style={{ fontSize: 10, letterSpacing: ".14em", color: "#b5abfc", marginLeft: 8 }}>
                  COMMISSIONER
                </span>
              ) : null}
            </span>
            <div style={{ display: "flex", gap: 3, flex: "0 0 auto" }}>
              {divisions.map((d) => (
                <button
                  key={d}
                  onClick={() => moveDivision(m, d)}
                  disabled={busy || m.division === d}
                  style={{
                    padding: "3px 8px",
                    fontSize: 10,
                    letterSpacing: ".12em",
                    border: `1px solid ${m.division === d ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.22)"}`,
                    background: m.division === d ? "rgba(145,132,217,.26)" : "transparent",
                    color: m.division === d ? "#e9e9ed" : "#75798c",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "inherit",
                    cursor: busy || m.division === d ? "default" : "pointer",
                  }}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>

            <span
              style={{
                fontSize: 10,
                letterSpacing: ".14em",
                padding: "2px 7px",
                borderRadius: 2,
                flex: "0 0 auto",
                border: `1px solid ${m.claimed ? "rgba(127,209,168,.5)" : "rgba(145,132,217,.35)"}`,
                color: m.claimed ? "#7fd1a8" : "#9397ab",
              }}
            >
              {m.claimed ? m.name : "OPEN"}
            </span>
            {m.claimed ? (
              <button onClick={() => clearPin(m)} disabled={busy} style={{ ...action(!busy), padding: "5px 10px", fontSize: 10 }}>
                Clear PIN
              </button>
            ) : null}
            {m.claimed && !m.isCommissioner ? (
              <button
                onClick={() => setReleasing(m)}
                disabled={busy}
                style={{
                  ...action(!busy),
                  padding: "5px 10px",
                  fontSize: 10,
                  border: "1px solid rgba(224,131,131,.4)",
                  color: "#c98f8f",
                }}
              >
                Let go
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div
        style={{
          ...card,
          border: "1px solid rgba(224,131,131,.26)",
          background: "rgba(43,28,32,.3)",
        }}
      >
        <h6 style={{ margin: "0 0 4px", color: "#e5a3a3" }}>Reset the league</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          Puts the league back to the day it was created. Every roster, the
          draft, the schedule and every result, live scores, trades, waiver
          claims, draft queues and pick-&rsquo;em picks are removed, and the
          board is redrawn empty.
        </p>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          The league itself stays: the franchises and their names, the
          divisions, these settings, the draft date, and the PINs people have
          already chosen &mdash; so nobody has to sign up again over a mistake
          in week three. The rosters are saved to the league&rsquo;s backups
          first, so they can be read back out with the service key.
        </p>
        <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 14px" }}>
          Unlike the draft reset, this is not refused once weeks have been
          played. That is what it is for. You will need to build the schedule
          again afterwards.
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            fontSize: 12,
            color: "#9397ab",
            lineHeight: 1.55,
            margin: "0 0 16px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={releaseFranchises}
            onChange={(e) => setReleaseFranchises(e.target.checked)}
            style={{ marginTop: 2, accentColor: "#c98f8f" }}
          />
          <span>
            Also release the franchises &mdash; PINs cleared and sign-ins
            broken, so they are open for new managers to claim. Yours is left
            alone; clearing it would lock you out of this page.
          </span>
        </label>

        <button
          onClick={() => setConfirmingReset(true)}
          disabled={busy}
          style={{
            padding: "8px 14px",
            border: "1px solid rgba(224,131,131,.5)",
            background: "transparent",
            color: "#e5a3a3",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 12,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.45 : 1,
          }}
        >
          Reset the league
        </button>
      </div>

      <ConfirmDialog
        open={releasing != null}
        title={`Let ${releasing?.name ?? "this manager"} go?`}
        eyebrow="THE FRANCHISE STAYS"
        confirmLabel="Let them go"
        busy={busy}
        onCancel={() => setReleasing(null)}
        onConfirm={() => {
          const manager = releasing;
          setReleasing(null);
          if (manager) void release(manager);
        }}
      >
        <p style={{ fontSize: 13, lineHeight: 1.75, color: "#9397ab", margin: "0 0 10px" }}>
          {releasing?.franchise} stays in the league exactly as it is — same
          name, same roster, same fixtures, same place in the draft. Only{" "}
          {releasing?.name ?? "the manager"} goes.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: "#75798c", margin: 0 }}>
          Their PIN and sign-in are cleared, so a browser they left open stops
          being that team at once. The seat is then open for somebody new to
          claim at sign-in, and they inherit the roster.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset the league?"
        confirmLabel="Reset the league"
        confirmWord={admin.league?.name ?? "reset"}
        busy={busy}
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => {
          setConfirmingReset(false);
          void resetLeague();
        }}
      >
        <p style={{ fontSize: 13, lineHeight: 1.75, color: "#9397ab", margin: "0 0 10px" }}>
          Everything that has happened in {admin.league?.name ?? "the league"} is
          removed: rosters, the draft, the schedule and any results already in
          it, scores, trades, claims and pick-&rsquo;em.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: "#75798c", margin: 0 }}>
          {releaseFranchises
            ? "The franchises are released too — every PIN but yours is cleared, and they are open to claim again."
            : "The franchises, their names and everyone's PIN are kept."}{" "}
          The rosters are saved to backups first.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * A way down the page that is not scrolling.
 *
 * The office is eight phone screens long, because it is nine unrelated jobs
 * that happen to belong to the same person: the league's size, draft night,
 * the rules, next season. Nobody arrives here wanting all nine — they arrive
 * wanting one, and the way to it was a thumb and about four flicks.
 *
 * A row of chips rather than a fold on each card. Folding would hide the one
 * thing a commissioner opened the page for behind a title they have to read
 * first, and it changes what the page looks like for somebody who already
 * knows their way around it. This adds a way in and takes nothing away.
 */
function OfficeMenu() {
  // Where the nav bar ends, so the rail can sit directly under it. Measured
  // rather than written down: the bar is 61px on a phone and 56px on a
  // desktop today, and a number in a stylesheet would be wrong the first time
  // anything in it changed — a gap, or a rail hidden behind the bar.
  const [top, setTop] = useState(0);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".gl-nav");
    if (!nav) return;

    // Inside a frame, so this is not a synchronous set during the effect.
    const measure = () =>
      requestAnimationFrame(() => setTop(Math.round(nav.getBoundingClientRect().height)));

    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(nav);
    return () => watch.disconnect();
  }, []);

  const places: [string, string][] = [
    ["office-size", "Size"],
    ["office-draft-day", "Draft day"],
    ["office-draft-settings", "Draft settings"],
    ["office-rosters", "Rosters"],
    ["office-schedule", "Schedule"],
    ["office-franchises", "Franchises"],
    ["office-rules", "Rules"],
    ["office-intro", "Intro film"],
    ["office-next-season", "Next season"],
  ];

  return (
    <div
      // A rail rather than a wrap: nine chips over three lines is a menu that
      // costs half a screen to save four flicks of a thumb.
      //
      // And it follows. This page is eight screens tall, and a menu that only
      // exists at the top of it is a menu you scroll back up to use — which is
      // most of what it was meant to save.
      className="gl-scroll-x"
      style={{
        display: "flex",
        gap: 6,
        margin: "0 0 18px",
        padding: "8px 0 10px",
        position: "sticky",
        top,
        zIndex: 15,
        background: "rgba(22,24,38,.94)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(145,132,217,.18)",
      }}
    >
      {places.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          style={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
            padding: "0 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(145,132,217,.28)",
            fontSize: 11.5,
            color: "#b5abfc",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
