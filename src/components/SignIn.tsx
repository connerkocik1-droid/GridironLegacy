"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Slot {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  claimed: boolean;
  isCommissioner: boolean;
}

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

export default function SignIn({
  leagueName,
}: {
  leagueName?: string | null;
} = {}) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [franchise, setFranchise] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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

  const current = slots?.find((s) => s.slot === selected) ?? null;
  // An unclaimed franchise is being taken for the first time, or retaken after
  // the commissioner cleared its PIN.
  const claiming = current != null && !current.claimed;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || busy) return;

    if (!/^\d{4}$/.test(pin)) {
      return setError("Your PIN must be exactly four digits.");
    }
    if (claiming && pin !== confirmPin) {
      return setError("Those PINs do not match.");
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(claiming ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          claiming
            ? { slot: current.slot, pin, franchise: franchise || undefined, name: name || undefined }
            : { slot: current.slot, pin },
        ),
      });

      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.needsSetup) {
        setNotice("This franchise needs a new PIN. Set one below.");
        await load();
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }

      router.push("/my-team");
      router.refresh();
    } catch {
      setError("That did not work.");
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

  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
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
      <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: "0 0 8px" }}>
        Pick your franchise and enter your four-digit PIN. If nobody has claimed
        it yet, you will set the PIN now.
      </p>

      <form onSubmit={submit}>
        <label htmlFor="slot" style={label}>
          FRANCHISE
        </label>
        <select
          id="slot"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setPin("");
            setConfirmPin("");
            setError(null);
            setNotice(null);
          }}
          style={field}
        >
          <option value="">Pick a franchise…</option>
          {slots.map((s) => (
            <option key={s.id} value={s.slot}>
              {s.franchise}
              {s.claimed ? "" : " — unclaimed"}
              {s.isCommissioner ? " · commissioner" : ""}
            </option>
          ))}
        </select>

        {claiming ? (
          <>
            <label htmlFor="name" style={label}>
              YOUR NAME (OPTIONAL)
            </label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} style={field} />

            <label htmlFor="franchise" style={label}>
              RENAME THE FRANCHISE (OPTIONAL)
            </label>
            <input
              id="franchise"
              value={franchise}
              onChange={(e) => setFranchise(e.target.value)}
              placeholder={current?.franchise}
              style={field}
            />
          </>
        ) : null}

        <label htmlFor="pin" style={label}>
          {claiming ? "CHOOSE A PIN" : "PIN"}
        </label>
        <input
          id="pin"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete={claiming ? "new-password" : "current-password"}
          type="password"
          placeholder="••••"
          style={{ ...field, letterSpacing: ".4em" }}
        />

        {claiming ? (
          <>
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
          </>
        ) : null}

        {notice ? (
          <div style={{ fontSize: 12, color: "#b5abfc", marginTop: 14 }}>{notice}</div>
        ) : null}
        {error ? <div style={{ fontSize: 12, color: "#e0b573", marginTop: 14 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={busy || !selected || pin.length < 4}
          style={{
            width: "100%",
            marginTop: 20,
            padding: "11px 16px",
            border: "1px solid rgba(181,171,252,.6)",
            background: "transparent",
            color: "#d2cefd",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 13,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            cursor: busy || !selected || pin.length < 4 ? "default" : "pointer",
            opacity: !selected || pin.length < 4 ? 0.45 : 1,
          }}
        >
          {claiming ? "Claim franchise" : "Sign in"}
        </button>
      </form>

      <p style={{ fontSize: 11, color: "#75798c", lineHeight: 1.6, marginTop: 20 }}>
        Forgotten your PIN? The commissioner can clear it — they cannot set a new
        one, so nobody can sign in as your team.
      </p>
    </div>
  );
}
