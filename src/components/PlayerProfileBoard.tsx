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
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
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
  color: "var(--text-dim)",
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
  owner: { id?: string; slot: string; franchise: string; mine: boolean; lineupSlot: string } | null;
  /** What this manager can do with him right now, and why not where not. */
  actions: {
    where: "mine" | "theirs" | "free";
    locked: boolean;
    irEligible: boolean;
    onIr: boolean;
    irRoom: boolean;
    rosterRoom: boolean;
    claim: boolean;
    clearsAt: string | null;
    tradeWith: string | null;
  } | null;
}

export default function PlayerProfileBoard({ name }: { name: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openWeeks, setOpenWeeks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
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

  /**
   * Every move this page can make, through the endpoints the Moves screen
   * already uses.
   *
   * Reloading afterwards rather than moving the button optimistically: the
   * roster has a capacity, the reserve has a size and a claim is not an add,
   * and all three are decided in the database. A page that guessed would be
   * wrong in exactly the cases a manager needs it to be right.
   */
  const act = useCallback(
    async (
      what: "add" | "drop" | "stash" | "recall",
      body: Record<string, unknown>,
      said: (answer: Record<string, unknown>) => string,
    ) => {
      if (busy) return;
      setBusy(true);
      setNotice(null);
      setTrouble(null);
      try {
        const res = await fetch(what === "drop" ? "/api/waivers" : endpointFor(what), {
          method: what === "drop" ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const answer = await res.json().catch(() => ({}));
        if (!res.ok) setTrouble(typeof answer.error === "string" ? answer.error : "That did not work.");
        else setNotice(said(answer));
        await load();
      } catch {
        setTrouble("That did not work.");
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "var(--warn)" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "var(--text-dim)" }}>
        Reading the player…
      </div>
    );
  }

  const { profile, news, season, owner, actions } = data;
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
            border: "1px solid rgb(var(--accent-rgb) / .35)",
            background: "rgb(var(--raised-rgb) / .7)",
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
              color: "var(--text)",
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
              color: "var(--text-muted)",
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
            {/* Worked out from his date of birth against today, so it is right
                in March as well as in August. */}
            {profile.age != null ? <span>{profile.age} years old</span> : null}

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
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 7, lineHeight: 1.5 }}>
              {health.detail}
              {health.note ? ` — ${health.note}` : ""}
            </div>
          ) : null}
        </div>
      </div>

      {/* Where he is, and what you can do about it.
          
          One card rather than a line of prose and a row of buttons somewhere
          else: the answer to "whose is he" and the answer to "can I have him"
          are the same question asked twice, and a manager who has just read
          his numbers is asking it now rather than after walking to the Moves
          screen to find out. */}
      {owner || actions ? (
        <div style={{ ...card, padding: "11px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {owner ? (
              owner.mine ? (
                <>
                  On <span style={{ color: "var(--good)" }}>your roster</span>
                  {owner.lineupSlot === "IR" ? ", on injured reserve" : ""}.
                </>
              ) : (
                <>
                  Held by <span style={{ color: "var(--text)" }}>{owner.franchise}</span>.
                </>
              )
            ) : actions?.claim && actions.clearsAt ? (
              <>
                On waivers — he clears{" "}
                <span style={{ color: "var(--text)" }}>{clearsIn(actions.clearsAt)}</span>.
              </>
            ) : (
              <>
                A <span style={{ color: "var(--accent-text)" }}>free agent</span>.
              </>
            )}
          </div>

          {actions ? (
            <Actions
              actions={actions}
              name={profile.name}
              busy={busy}
              act={act}
            />
          ) : null}

          {trouble ? (
            <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 9, lineHeight: 1.5 }}>
              {trouble}
            </div>
          ) : null}
          {notice ? (
            <div style={{ fontSize: 11.5, color: "var(--good)", marginTop: 9, lineHeight: 1.5 }}>
              {notice}
            </div>
          ) : null}
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
                  color: "var(--accent-text)",
                  marginBottom: 7,
                }}
              >
                {profile.archetype}
              </div>
            ) : null}
            {profile.insight ? (
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65, margin: 0 }}>
                {profile.insight}
              </p>
            ) : null}
            {profile.adp != null ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
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
                    color: "var(--text-2)",
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
                  color: "var(--accent-link)",
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
                      borderTop: "1px solid rgb(var(--accent-rgb) / .14)",
                      alignItems: "baseline",
                    }}
                  >
                    <span style={{ ...label, width: 46, flex: "0 0 auto" }}>WK {w.week}</span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        color: "var(--text-2)",
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
                        color: "var(--accent-text)",
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
          <div style={{ padding: "16px 18px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
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
              <div style={{ padding: "14px 16px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                No {LAST_SEASON} line on file for him.
              </div>
            ) : null}
            {profile.career.map((s) => (
              <div
                key={`${s.year}-${s.team}`}
                style={{ padding: "12px 16px", borderTop: "1px solid rgb(var(--accent-rgb) / .14)" }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 14,
                      color: "var(--text)",
                    }}
                  >
                    {s.year}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {s.team} · {s.position}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                  {s.line}
                </div>
                {s.line2 ? (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5, overflowWrap: "anywhere" }}>
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
        <div style={{ ...card, padding: "14px 16px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          This player was never in the draft pool, so there is nothing here but
          what the league itself has recorded about him.
        </div>
      ) : null}

      <div style={{ marginTop: 20, fontSize: 11.5 }}>
        <Link
          href="/rankings"
          style={{
            color: "var(--accent-link)",
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
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)" }}>{name}</div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 19,
          marginTop: 3,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Which endpoint a move goes to. Drop and add share one; the reserve has two. */
function endpointFor(what: "add" | "stash" | "recall"): string {
  // Signing a free agent straight onto the reserve is a waiver move; moving
  // one of your own on or off it is a lineup move. Two endpoints because they
  // are two different rules, not because they are two different words.
  return what === "add" ? "/api/waivers" : "/api/lineup";
}

/** "in 4 hours", or "on Tuesday" once it is further off than a day. */
function clearsIn(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "soon";
  const mins = Math.round((when.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "any moment";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `on ${when.toLocaleDateString(undefined, { weekday: "long" })}`;
}

/**
 * The buttons.
 *
 * Which ones appear is the whole of it, and it is decided by where he is
 * rather than by what the reader might like: a man on somebody else's roster
 * cannot be added however much you want him, and offering the button anyway
 * is a tap that ends in a refusal.
 *
 * Yours — drop him, trade him away, and send him to the reserve when the
 * injury report puts him there. Somebody else's — a trade, and nothing else.
 * A free agent — add him, or claim him when he is on the wire, and the one
 * add that costs no roster spot when he is hurt enough to sit outside it.
 *
 * A button that cannot be pressed says why on itself rather than disappearing.
 * A move that has vanished is a move a manager goes looking for; a move that
 * is greyed out with "his game has started" on it is an answer.
 */
function Actions({
  actions,
  name,
  busy,
  act,
}: {
  actions: NonNullable<Payload["actions"]>;
  name: string;
  busy: boolean;
  act: (
    what: "add" | "drop" | "stash" | "recall",
    body: Record<string, unknown>,
    said: (answer: Record<string, unknown>) => string,
  ) => void;
}) {
  const { where, locked, irEligible, onIr, irRoom, rosterRoom, claim } = actions;

  const row: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 11,
  };

  if (where === "mine") {
    return (
      <div style={row}>
        <Button
          label="Drop"
          tone="warn"
          busy={busy}
          why={locked ? "His game has started" : null}
          onClick={() =>
            act("drop", { drop: name }, (answer) =>
              answer.clearsAt
                ? `${name} is on waivers — he ${clearsIn(String(answer.clearsAt))}.`
                : `${name} was dropped.`,
            )
          }
        />

        <TradeButton />

        {/* Only where the database will take it. The reserve is for the men
            the injury report puts there, and it has a size. */}
        {onIr ? (
          <Button
            label="Off reserve"
            busy={busy}
            why={!rosterRoom ? "Your roster is full" : null}
            onClick={() =>
              act("recall", { player: name, ir: false }, () => `${name} is back on your roster.`)
            }
          />
        ) : irEligible ? (
          <Button
            label="To reserve"
            busy={busy}
            why={!irRoom ? "Your reserve is full" : locked ? "His game has started" : null}
            onClick={() =>
              act("stash", { player: name, ir: true }, () =>
                `${name} is on your injured reserve. He costs you no roster spot.`,
              )
            }
          />
        ) : null}
      </div>
    );
  }

  if (where === "theirs") {
    // One button, because there is genuinely one thing you can do. A roster
    // is somebody's property and the only way through it is an offer.
    return (
      <div style={row}>
        <TradeButton with={actions.tradeWith} want={name} />
      </div>
    );
  }

  return (
    <div style={row}>
      <Button
        label={claim ? "Claim" : "Add"}
        tone="go"
        busy={busy}
        // A full roster refuses this one whatever his fitness. The reserve is
        // the other button, and it is the other button precisely because it
        // does not cost a roster spot — folding the two together here made
        // this one claim it would work when the database would refuse it.
        why={
          locked
            ? "His game has started"
            : !rosterRoom
              ? "Your roster is full — drop somebody first"
              : null
        }
        onClick={() =>
          act("add", { add: name }, (answer) =>
            answer.mode === "now"
              ? `${name} is on your roster.`
              : `Claim placed for ${name}. It settles on the next waiver run.`,
          )
        }
      />

      {/* The one add that costs no roster spot, and the reason it is safe:
          he cannot play. Offered even on a full roster, which is the whole
          point of it. */}
      {irEligible ? (
        <Button
          label="Add to reserve"
          busy={busy}
          why={!irRoom ? "Your reserve is full" : null}
          onClick={() =>
            act("add", { add: name, ir: true }, () =>
              `${name} is on your injured reserve. He costs you no roster spot.`,
            )
          }
        />
      ) : null}
    </div>
  );
}

/** A way into the trade desk, already pointed at the right franchise. */
function TradeButton({ with: partner, want }: { with?: string | null; want?: string } = {}) {
  const query = new URLSearchParams({ tab: "trade-builder" });
  if (partner) query.set("with", partner);
  if (want) query.set("want", want);

  return (
    <Link
      href={`/moves?${query.toString()}`}
      style={{
        ...buttonBase,
        border: "1px solid rgb(var(--accent-rgb) / .4)",
        color: "var(--accent-text)",
        textDecoration: "none",
      }}
    >
      Trade
    </Link>
  );
}

function Button({
  label,
  onClick,
  busy,
  why,
  tone,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  /** Why it cannot be pressed, which is also what it says. */
  why: string | null;
  tone?: "go" | "warn";
}) {
  const off = busy || why != null;

  return (
    <button
      type="button"
      onClick={off ? undefined : onClick}
      disabled={off}
      title={why ?? undefined}
      style={{
        ...buttonBase,
        cursor: off ? "default" : "pointer",
        border: `1px solid ${
          off
            ? "rgb(var(--accent-rgb) / .2)"
            : tone === "go"
              ? "rgb(var(--good-rgb) / .5)"
              : tone === "warn"
                ? "rgb(var(--bad-rgb) / .45)"
                : "rgb(var(--accent-rgb) / .4)"
        }`,
        color: off
          ? "var(--text-off)"
          : tone === "go"
            ? "var(--good)"
            : tone === "warn"
              ? "var(--bad-text)"
              : "var(--accent-text)",
        background: "transparent",
      }}
    >
      {why ?? label}
    </button>
  );
}

const buttonBase: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 11.5,
  letterSpacing: ".1em",
  // A thumb needs somewhere to land.
  minHeight: 40,
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "var(--radius-sm)",
};
