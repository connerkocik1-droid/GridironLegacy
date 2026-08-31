"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POOL, headshot } from "@/data/league-data";
import DraftCountdown from "./DraftCountdown";
import DraftReveal, { type RevealPick } from "./DraftReveal";
import IntroVideo from "./IntroVideo";
import { ageOfPlayer, dynastyAdp } from "@/lib/dynasty";

/**
 * A rehearsal room for the draft-day theatrics.
 *
 * It drives the same DraftReveal and DraftCountdown the real room does, so
 * what you see here is what happens on the night — the point is to find out
 * whether the chime is blocked and whether the portraits load *before* twelve
 * people are watching, not during.
 *
 * Nothing here touches the database, so it works before Supabase is wired up
 * and cannot disturb a real draft.
 */

const FRANCHISES = [
  "Steel Cartel",
  "Blaze Syndicate",
  "Ravenous",
  "Apex Union",
  "Nova Collective",
  "Helix Nine",
];

type ChimeState = "untested" | "blocked" | "ready" | "playing" | "missing";

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  padding: "16px 18px",
  marginBottom: 16,
};

const button = (enabled = true): React.CSSProperties => ({
  padding: "9px 15px",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

export default function DraftRehearsal() {
  const [reveal, setReveal] = useState<RevealPick | null>(null);
  // The league's own intro, so the rehearsal is of the real file rather than
  // of the idea of one. Fetched rather than passed in, and a failure here is
  // silent: the rest of the room has never needed the database and should not
  // start now.
  const [intro, setIntro] = useState<string | null>(null);
  const [introState, setIntroState] = useState<"loading" | "ready" | "none">("loading");
  const [playingIntro, setPlayingIntro] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string>("");
  const [mine, setMine] = useState(false);
  const [chimeState, setChimeState] = useState<ChimeState>("untested");
  const [portrait, setPortrait] = useState<"unknown" | "ok" | "failed">("unknown");
  const [countdownMins, setCountdownMins] = useState(2);
  // Pinned when the choice changes, not read during render: a target
  // recomputed every render stays the same distance away and never ticks.
  const [countdownTo, setCountdownTo] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const chime = useRef<HTMLAudioElement | null>(null);
  const sequence = useRef<ReturnType<typeof setTimeout>[]>([]);

  const note = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 12));
  }, []);

  // Whatever is typed, best first by ADP.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return POOL.filter((p) => (q ? p.n.toLowerCase().includes(q) : true))
      .sort((a, b) => dynastyAdp(a.p, a.adp, ageOfPlayer(a.n)) - dynastyAdp(b.p, b.adp, ageOfPlayer(b.n)))
      .slice(0, 8);
  }, [search]);

  const player = chosen || matches[0]?.n || "";

  useEffect(() => () => sequence.current.forEach(clearTimeout), []);

  useEffect(() => {
    const t = setTimeout(
      () => setCountdownTo(new Date(Date.now() + countdownMins * 60_000).toISOString()),
      0,
    );
    return () => clearTimeout(t);
  }, [countdownMins]);

  /**
   * The league's own intro film, if there is one.
   *
   * The only thing in this room that asks the server anything, and it asks
   * nothing of it: a failure leaves the card saying there is no film, and
   * every other check here still works with no database at all.
   */
  useEffect(() => {
    const stop = new AbortController();

    fetch("/api/admin/league", { cache: "no-store", signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const src = data?.league?.settings?.introVideo;
        if (typeof src === "string" && src) {
          setIntro(src);
          setIntroState("ready");
        } else {
          setIntroState("none");
        }
      })
      .catch(() => setIntroState("none"));

    return () => stop.abort();
  }, []);

  /** Does the portrait actually load? This is the ESPN CDN question. */
  useEffect(() => {
    if (!player) return;

    const url = headshot(player);
    if (!url) {
      // Reported through a timer rather than synchronously, so the effect only
      // ever schedules work.
      const t = setTimeout(() => setPortrait("failed"), 0);
      return () => clearTimeout(t);
    }

    const img = new Image();
    img.onload = () => setPortrait("ok");
    img.onerror = () => setPortrait("failed");
    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [player]);

  async function testChime() {
    const audio = chime.current;
    if (!audio) {
      setChimeState("missing");
      note("No audio element — the file never mounted.");
      return;
    }

    try {
      audio.currentTime = 0;
      audio.volume = 0.85;
      setChimeState("playing");
      await audio.play();
      note("Chime played. Autoplay is unblocked in this browser.");
      setChimeState("ready");
    } catch (err) {
      // This is the failure worth catching before draft night: browsers refuse
      // to play audio until the page has been interacted with, and a chime
      // that is refused once is simply never heard.
      setChimeState("blocked");
      note(`Chime blocked: ${(err as Error).name}. Click the page, then retry.`);
    }
  }

  function fire(name: string, round: number, overall: number, isMine: boolean) {
    const audio = chime.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => note("Chime was blocked on this pick."));
    }
    setReveal({
      playerName: name,
      franchise: FRANCHISES[(overall - 1) % FRANCHISES.length],
      slot: "",
      overall,
      round,
      mine: isMine,
    });
    note(`Reveal fired: ${name} (round ${round}, pick ${overall}${isMine ? ", yours" : ""}).`);
  }

  /** Three picks back to back, as the opening of a real draft feels. */
  function runSequence() {
    sequence.current.forEach(clearTimeout);
    sequence.current = [];

    const picks = POOL.slice(0, 3).map((p) => p.n);
    note("Running three picks back to back.");

    picks.forEach((name, i) => {
      sequence.current.push(
        setTimeout(() => fire(name, 1, i + 1, false), i * 13_000),
      );
    });
  }

  const chimeColor =
    chimeState === "ready"
      ? "#7fd1a8"
      : chimeState === "blocked" || chimeState === "missing"
        ? "#e0b573"
        : "#9397ab";

  return (
    <div style={{ padding: "24px 26px 40px", maxWidth: 860 }}>
      <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
      <DraftReveal pick={reveal} onClose={() => setReveal(null)} />

      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>REHEARSAL</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        Draft day, dry run
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.7, maxWidth: "68ch", margin: "0 0 20px" }}>
        The same reveal and countdown the draft room uses, driven by hand.
        Nothing here touches the database, so it cannot disturb a real draft —
        and it works before the league is set up. Find out here whether the
        chime is blocked and whether the portraits load, rather than on the
        night with eleven people watching.
      </p>

      {playingIntro && intro ? (
        <IntroVideo src={intro} onDone={() => setPlayingIntro(false)} caption="REHEARSAL" />
      ) : null}

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>The intro film</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 12px" }}>
          What the room sees the moment the countdown runs out. This is the
          league&rsquo;s own file, played through the same screen — so if it
          plays here, with sound, it plays on the night. If the browser refuses
          the sound you will see it say so, which is the answer worth having in
          advance.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setPlayingIntro(true)}
            disabled={introState !== "ready"}
            style={button(introState === "ready")}
          >
            Play the intro
          </button>
          <span style={{ fontSize: 12, color: introState === "ready" ? "#7fd1a8" : "#9397ab" }}>
            {introState === "loading"
              ? "Looking for the league's film…"
              : introState === "ready"
                ? "Ready. It plays full screen and can be skipped."
                : "No film set. The commissioner uploads one in the league office."}
          </span>
        </div>
      </div>

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>The chime</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 12px" }}>
          Browsers refuse to play audio until the page has been interacted
          with. The real room primes it silently on your first click; here you
          can check it outright.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={testChime} style={button()}>
            Play the chime
          </button>
          <span style={{ fontSize: 12, color: chimeColor }}>
            {chimeState === "untested"
              ? "Not tested yet."
              : chimeState === "ready"
                ? "Playing — autoplay is unblocked."
                : chimeState === "playing"
                  ? "Playing…"
                  : chimeState === "blocked"
                    ? "Blocked by the browser. Click anywhere, then try again."
                    : "The audio file did not mount."}
          </span>
        </div>
      </div>

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>The reveal</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 12px" }}>
          Five beats over ten seconds. A pick that is not yours closes itself
          after twelve and a half; yours waits to be dismissed.
        </p>

        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setChosen("");
          }}
          placeholder="Search for a player"
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
          }}
        />

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "10px 0 14px" }}>
          {matches.map((p) => (
            <button
              key={p.n}
              onClick={() => setChosen(p.n)}
              style={{
                padding: "5px 10px",
                fontSize: 11,
                border: `1px solid ${player === p.n ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.22)"}`,
                background: player === p.n ? "rgba(145,132,217,.26)" : "transparent",
                color: player === p.n ? "#e9e9ed" : "#9397ab",
                borderRadius: "var(--radius-sm)",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {p.n} · {p.p}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => fire(player, 1, 1, mine)} style={button(Boolean(player))}>
            Run the reveal
          </button>
          <button onClick={runSequence} style={button()}>
            Three in a row
          </button>
          <label style={{ fontSize: 12, color: "#9397ab", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            as my own pick
          </label>
        </div>

        <div style={{ fontSize: 11.5, marginTop: 12, color: portrait === "failed" ? "#e0b573" : "#75798c" }}>
          {portrait === "ok"
            ? `Portrait for ${player} loads.`
            : portrait === "failed"
              ? `Portrait for ${player} did NOT load — the reveal will show an empty circle. Headshots hotlink ESPN's CDN.`
              : "Checking the portrait…"}
        </div>
      </div>

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>The countdown</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 12px" }}>
          What everyone sees before the room opens. Set it a couple of minutes
          out and watch it tick.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          {[2, 60, 60 * 26].map((m) => (
            <button
              key={m}
              onClick={() => setCountdownMins(m)}
              style={{
                padding: "5px 11px",
                fontSize: 11,
                border: `1px solid ${countdownMins === m ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.22)"}`,
                background: countdownMins === m ? "rgba(145,132,217,.26)" : "transparent",
                color: countdownMins === m ? "#e9e9ed" : "#9397ab",
                borderRadius: "var(--radius-sm)",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {m < 60 ? `${m} min` : m < 1440 ? `${m / 60} hr` : `${Math.round(m / 60)} hr`}
            </button>
          ))}
        </div>

        <div
          style={{
            border: "1px solid rgba(145,132,217,.16)",
            borderRadius: "var(--radius-md)",
            background: "rgba(20,22,35,.4)",
          }}
        >
          <DraftCountdown
            draftAt={countdownTo}
            skew={0}
            state="pending"
            isCommissioner={false}
            managers={FRANCHISES.map((f, i) => ({ id: String(i), franchise: f }))}
            onStart={() => {}}
            busy={false}
          />
        </div>
      </div>

      {log.length ? (
        <div style={card}>
          <h6 style={{ margin: "0 0 8px", color: "#9397ab" }}>What happened</h6>
          {log.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 11.5,
                color: i === 0 ? "#9397ab" : "#75798c",
                fontVariantNumeric: "tabular-nums",
                padding: "3px 0",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
