"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Signing in, and claiming a franchise for the first time.
 *
 * Both paths are the same walk: look at the franchises, pick one, do the one
 * thing it asks for. Signing in opens a PIN box inside the card you pressed;
 * signing up asks whether you mean it and then takes a name and a PIN. The
 * franchises are the interesting part of this page, so neither path hides
 * them behind a dropdown.
 */

interface Slot {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  claimed: boolean;
  isCommissioner: boolean;
}

type Mode = "landing" | "signin" | "pick" | "confirm" | "activate";

const field: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.3)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 14,
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
  margin: "14px 0 6px",
};

const primary = (enabled: boolean): React.CSSProperties => ({
  width: "100%",
  marginTop: 18,
  padding: "12px 16px",
  border: "1px solid rgba(181,171,252,.6)",
  background: "rgba(145,132,217,.14)",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 13,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

const quiet: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#9397ab",
  font: "inherit",
  fontSize: 12,
  padding: 0,
  cursor: "pointer",
  textDecoration: "underline",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(158px, 1fr))",
  gap: 9,
  margin: "16px 0 4px",
  alignItems: "start",
};

const cardEyebrow = (bright: boolean): React.CSSProperties => ({
  fontSize: 10,
  letterSpacing: ".18em",
  color: bright ? "#b5abfc" : "#75798c",
});

const cardName: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 15,
  color: "#e9e9ed",
  margin: "5px 0 3px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** What a franchise will be called once somebody puts their name to it. */
export function teamNameFor(firstName: string): string {
  return `${firstName.trim()}'s Team`;
}

export default function SignIn({ leagueName }: { leagueName?: string | null } = {}) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("landing");
  const [chosen, setChosen] = useState<Slot | null>(null);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);

  // Pressing a card should put the caret in the PIN box it just opened, so
  // the next thing you do is type your PIN rather than hunt for the field.
  const focusPin = useCallback((el: HTMLInputElement | null) => el?.focus(), []);
  const cardPin = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/slots", { cache: "no-store" });
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setSlots(body.slots ?? []);
      setError(null);
    } catch {
      setError("Could not read the league.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function go(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function signIn(seat: Slot) {
    if (busy) return;
    if (!/^\d{4}$/.test(pin)) return setError("Your PIN must be exactly four digits.");

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: seat.slot, pin }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.needsSetup) {
        // The commissioner cleared this PIN, so the franchise is claimable
        // again. Walk them into claiming it rather than leaving them at a box
        // that will not work.
        setChosen(seat);
        setPin("");
        go("confirm");
        setNotice("That franchise needs a new PIN. Claim it again below.");
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        cardPin.current?.focus();
        cardPin.current?.select();
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !chosen) return;

    if (!firstName.trim()) return setError("Your first name is required.");
    if (!/^\d{4}$/.test(pin)) return setError("Your PIN must be exactly four digits.");
    if (pin !== confirmPin) return setError("Those PINs do not match.");

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: chosen.slot, pin, name: firstName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "That franchise could not be claimed.");

      router.push("/");
      router.refresh();
    } catch {
      setError("That franchise could not be claimed.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !slots) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!slots) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the league…</div>;
  }

  const free = slots.filter((s) => !s.claimed);
  const anyClaimed = slots.some((s) => s.claimed);

  const heading = (
    <>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>
        DYNASTY · {slots.length} TEAM · SUPERFLEX
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          lineHeight: 1.04,
          letterSpacing: "-.035em",
          margin: "10px 0 6px",
          fontWeight: 500,
        }}
      >
        {leagueName ?? "Gridiron Legacy"}
      </h1>
    </>
  );

  const messages = (
    <>
      {notice ? <div style={{ fontSize: 12, color: "#b5abfc", marginTop: 14 }}>{notice}</div> : null}
      {error ? <div style={{ fontSize: 12, color: "#e0b573", marginTop: 14 }}>{error}</div> : null}
    </>
  );

  // ------------------------------------------------------------- landing ---
  if (mode === "landing") {
    return (
      <div>
        {heading}
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: "0 0 8px" }}>
          Twelve managers, one league, and a franchise each. Sign in if you have
          one, sign up to take one of the teams that are still going.
        </p>
        {messages}

        <button
          onClick={() => {
            setPin("");
            setChosen(null);
            go("signin");
          }}
          style={primary(true)}
        >
          Sign in
        </button>
        <button
          onClick={() => {
            setChosen(null);
            go("pick");
          }}
          style={{
            ...primary(true),
            marginTop: 10,
            background: "transparent",
            border: "1px solid rgba(145,132,217,.3)",
            color: "#9397ab",
          }}
        >
          Sign up
        </button>

        <div style={{ fontSize: 12, color: "#75798c", marginTop: 16, textAlign: "center" }}>
          {free.length
            ? `${free.length} ${free.length === 1 ? "franchise is" : "franchises are"} still open.`
            : "Every franchise is taken."}
        </div>

        <p style={{ fontSize: 11, color: "#75798c", lineHeight: 1.6, marginTop: 20 }}>
          Forgotten your PIN? The commissioner can clear it — they cannot set a
          new one, so nobody can sign in as your team.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------- sign in ---
  if (mode === "signin") {
    return (
      <div>
        {heading}
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: "0 0 4px" }}>
          {anyClaimed
            ? "Press your franchise, then type your PIN."
            : "Nobody has claimed a franchise yet. Sign up to be the first."}
        </p>
        {!chosen ? messages : null}

        <div style={grid}>
          {slots.map((s) => {
            const mine = chosen?.id === s.id;
            const usable = s.claimed;

            const inside = (
              <>
                <div style={cardEyebrow(usable)}>
                  {s.slot}
                  {s.isCommissioner ? " · COMMISSIONER" : ""}
                </div>
                <div style={cardName}>{s.franchise}</div>
                <div style={{ fontSize: 10.5, color: usable ? "#9397ab" : "#75798c" }}>
                  {usable ? s.name : "Open · sign up to claim"}
                </div>
              </>
            );

            const skin: React.CSSProperties = {
              textAlign: "left",
              padding: "13px 13px 12px",
              border: `1px solid ${
                mine
                  ? "rgba(181,171,252,.75)"
                  : usable
                    ? "rgba(181,171,252,.45)"
                    : "rgba(145,132,217,.14)"
              }`,
              borderRadius: "var(--radius-sm)",
              background: usable ? "rgba(145,132,217,.1)" : "rgba(20,22,35,.5)",
              color: "inherit",
              font: "inherit",
              // Unclaimed teams are still listed — seeing which are gone is the
              // point — but they are plainly not a way in.
              opacity: usable ? 1 : 0.42,
            };

            // The PIN box lives inside the card that opened it. A button
            // cannot contain a text field, so a pressed card stops being one.
            if (mine) {
              return (
                <div key={s.id} style={{ ...skin, gridColumn: "1 / -1" }}>
                  {inside}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void signIn(s);
                    }}
                  >
                    <label htmlFor="card-pin" style={{ ...label, margin: "12px 0 6px" }}>
                      PIN
                    </label>
                    <input
                      id="card-pin"
                      ref={(el) => {
                        cardPin.current = el;
                        focusPin(el);
                      }}
                      value={pin}
                      onChange={(e) => {
                        setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                        setError(null);
                      }}
                      inputMode="numeric"
                      autoComplete="current-password"
                      type="password"
                      placeholder="••••"
                      style={{ ...field, maxWidth: 220, letterSpacing: ".4em" }}
                    />
                    {messages}
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <button
                        type="submit"
                        disabled={busy || pin.length < 4}
                        style={{
                          ...primary(!busy && pin.length === 4),
                          width: "auto",
                          padding: "10px 24px",
                          marginTop: 14,
                        }}
                      >
                        {busy ? "Signing in…" : "Sign in"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChosen(null);
                          setPin("");
                          setError(null);
                        }}
                        style={{ ...quiet, marginTop: 14 }}
                      >
                        Different franchise
                      </button>
                    </div>
                  </form>
                </div>
              );
            }

            return (
              <button
                key={s.id}
                onClick={() => {
                  if (!usable) return;
                  setChosen(s);
                  setPin("");
                  setError(null);
                }}
                disabled={!usable}
                aria-label={`${s.franchise} — ${usable ? `sign in as ${s.name}` : "open"}`}
                style={{ ...skin, cursor: usable ? "pointer" : "default" }}
              >
                {inside}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
          <button onClick={() => go("landing")} style={quiet}>
            Back
          </button>
          <button
            onClick={() => {
              setChosen(null);
              go("pick");
            }}
            style={quiet}
          >
            Sign up instead
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------- pick a team ---
  if (mode === "pick") {
    return (
      <div>
        {heading}
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: "0 0 4px" }}>
          Pick a franchise. The greyed-out ones already belong to somebody.
        </p>
        {messages}

        <div style={grid}>
          {slots.map((s) => {
            const open = !s.claimed;
            return (
              <button
                key={s.id}
                onClick={() => {
                  if (!open) return;
                  setChosen(s);
                  go("confirm");
                }}
                disabled={!open}
                aria-label={`${s.franchise} — ${open ? "open" : `taken by ${s.name}`}`}
                style={{
                  textAlign: "left",
                  padding: "13px 13px 12px",
                  border: `1px solid ${open ? "rgba(181,171,252,.45)" : "rgba(145,132,217,.14)"}`,
                  borderRadius: "var(--radius-sm)",
                  background: open ? "rgba(145,132,217,.1)" : "rgba(20,22,35,.5)",
                  color: "inherit",
                  font: "inherit",
                  cursor: open ? "pointer" : "default",
                  // Taken teams are still listed — seeing the league fill up is
                  // the point — but they are plainly not on offer.
                  opacity: open ? 1 : 0.42,
                }}
              >
                <div style={cardEyebrow(open)}>
                  {s.slot}
                  {s.isCommissioner ? " · COMMISSIONER" : ""}
                </div>
                <div style={cardName}>{s.franchise}</div>
                <div style={{ fontSize: 10.5, color: open ? "#7fd1a8" : "#75798c" }}>
                  {open ? "Open" : `Taken · ${s.name}`}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
          <button onClick={() => go("landing")} style={quiet}>
            Back
          </button>
          <button
            onClick={() => {
              setChosen(null);
              setPin("");
              go("signin");
            }}
            style={quiet}
          >
            I already have a franchise
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------- confirm ---
  if (mode === "confirm" && chosen) {
    return (
      <div>
        {heading}
        <div
          style={{
            border: "1px solid rgba(181,171,252,.45)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(145,132,217,.1)",
            padding: "20px 20px 18px",
            margin: "10px 0 4px",
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: ".18em", color: "#b5abfc" }}>{chosen.slot}</div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 26,
              color: "#e9e9ed",
              margin: "6px 0 4px",
            }}
          >
            {chosen.franchise}
          </div>
          <div style={{ fontSize: 11, color: "#75798c" }}>
            {chosen.isCommissioner ? "The commissioner's franchise" : "Open"}
          </div>
        </div>

        <p
          style={{
            fontSize: 15,
            color: "#e9e9ed",
            lineHeight: 1.6,
            margin: "18px 0 0",
            textAlign: "center",
          }}
        >
          Would you like to claim this franchise?
        </p>
        {messages}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={() => {
              setFirstName("");
              setPin("");
              setConfirmPin("");
              go("activate");
            }}
            style={{ ...primary(true), marginTop: 0 }}
          >
            Yes
          </button>
          <button
            onClick={() => {
              setChosen(null);
              go("pick");
            }}
            style={{
              ...primary(true),
              marginTop: 0,
              background: "transparent",
              border: "1px solid rgba(145,132,217,.3)",
              color: "#9397ab",
            }}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- activate ---
  if (mode === "activate" && chosen) {
    const ready = Boolean(firstName.trim()) && pin.length === 4 && confirmPin.length === 4;
    return (
      <div>
        {heading}
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: "0 0 2px" }}>
          Claiming <strong style={{ color: "#d2cefd", fontWeight: 500 }}>{chosen.slot}</strong>. Your
          first name and a four-digit PIN are all it takes.
        </p>

        <form onSubmit={activate}>
          <label htmlFor="firstName" style={label}>
            FIRST NAME
          </label>
          <input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value.slice(0, 40))}
            autoComplete="given-name"
            style={field}
          />
          <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "7px 0 0" }}>
            {firstName.trim() ? (
              <>
                Your team will be called{" "}
                <strong style={{ color: "#b5abfc", fontWeight: 500 }}>
                  {teamNameFor(firstName)}
                </strong>{" "}
                until you rename it — you can do that any time from the profile
                button in the corner.
              </>
            ) : (
              "Your team is named after you until you rename it, and it is how the rest of the league knows whose team they are looking at."
            )}
          </p>

          <label htmlFor="pin" style={label}>
            CHOOSE A PIN
          </label>
          <input
            id="pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="new-password"
            type="password"
            placeholder="••••"
            style={{ ...field, letterSpacing: ".4em" }}
          />

          <label htmlFor="confirm" style={label}>
            CONFIRM PIN
          </label>
          <input
            id="confirm"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="new-password"
            type="password"
            placeholder="••••"
            style={{ ...field, letterSpacing: ".4em" }}
          />

          {messages}

          <button type="submit" disabled={busy || !ready} style={primary(!busy && ready)}>
            {busy ? "Activating…" : "Activate franchise"}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <button onClick={() => go("confirm")} style={quiet}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // A mode that needs a franchise and has none: back to the list.
  return (
    <div>
      {heading}
      <button onClick={() => go("pick")} style={quiet}>
        Pick a franchise
      </button>
    </div>
  );
}
