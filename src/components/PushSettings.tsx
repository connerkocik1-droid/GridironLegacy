"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Notifications on the phone, and which of them.
 *
 * Two separate things behind one panel, and they are worth keeping apart in
 * your head because they behave differently. Permission and the subscription
 * belong to *this browser*: turning them on here does nothing for the same
 * manager's laptop. The four choices belong to the *manager* and follow them
 * everywhere they sign in.
 *
 * Everything starts off. Turning notifications on is a thing somebody does,
 * and a league that started buzzing people because it shipped a feature would
 * be a league eleven people turned notifications off in.
 */

const KINDS = [
  {
    key: "scores" as const,
    title: "Scoring updates",
    note: "When the lead in your matchup changes hands. Not every score — a phone that buzzes thirty times on a Sunday is a phone with this switched off by teatime.",
  },
  {
    key: "recap" as const,
    title: "Weekly recap",
    note: "How your week finished, once it is graded.",
  },
  {
    key: "injuries" as const,
    title: "Injuries",
    note: "When somebody on your roster is ruled out, downgraded or put on IR. A doubt is not worth waking you for.",
  },
  {
    key: "projections" as const,
    title: "Weekly projections",
    note: "What your best eleven project before the week kicks off, and what the other fellow projects.",
  },
];

type Kind = (typeof KINDS)[number]["key"];
type Prefs = Record<Kind, boolean>;

const EMPTY: Prefs = { scores: false, recap: false, injuries: false, projections: false };

/** The application key, as the byte array pushManager.subscribe insists on. */
function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushSettings() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** This browser's subscription, if it has one. */
  const current = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }, []);

  const load = useCallback(async () => {
    // The two questions asked in one go: whether this browser could ever do
    // this, and what the server already knows about it.
    const able =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(able);

    const sub = able ? await current() : null;
    const where = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";

    try {
      const res = await fetch(`/api/push${where}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setConfigured(Boolean(body.configured));
      setPublicKey(body.publicKey ?? null);
      setPrefs({ ...EMPTY, ...(body.prefs ?? {}) });
      // Signed up only when both halves agree: a subscription this browser
      // holds and a row the server holds for it. A browser that was reset
      // still has permission and no subscription, and would otherwise show as
      // on while receiving nothing.
      setOn(Boolean(sub) && Boolean(body.subscribed));
    } catch {
      // Leave the panel as it was. Nothing here is worth an error message
      // about the network.
    }
  }, [current]);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function turnOn() {
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "This browser is set to block notifications from the app. That is changed in the browser's own settings for this site, not here."
            : "Notifications were not allowed.",
        );
        return;
      }

      if (!publicKey) {
        setError("The league has not been set up to send notifications yet.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required, and honoured: every message this app sends shows
          // something. A silent push is what gets a site's permission revoked
          // by the browser without anybody being asked.
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey) as BufferSource,
        }));

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });

      if (!res.ok) {
        setError("This browser was allowed, but the league could not record it.");
        return;
      }

      setOn(true);

      // On, with nothing chosen, is a switch that does nothing. The recap is
      // the one nobody regrets: once a week, after the fact.
      if (!Object.values(prefs).some(Boolean)) {
        await save({ ...prefs, recap: true });
        setNote("On. The weekly recap is set; choose any others below.");
      } else {
        setNote("On for this device.");
      }
    } catch {
      setError("This browser would not sign up for notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const sub = await current();
      if (sub) {
        await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setOn(false);
      // The four are left as they were: turning a device off is not the same
      // as changing your mind about what you want, and a manager with a phone
      // and a laptop is still signed up on the other one.
      setNote("Off for this device.");
    } catch {
      setError("Could not turn them off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save(next: Prefs) {
    setPrefs(next);
    const res = await fetch("/api/push", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      setError("Could not save that.");
      await load();
    }
  }

  if (supported === null) return null;

  if (!supported) {
    return (
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
        This browser cannot send notifications. On an iPhone they work once the
        app has been added to the home screen — from Safari, Share, then Add to
        Home Screen.
      </p>
    );
  }

  if (!configured) {
    return (
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
        The league has not been set up to send notifications yet.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
        {on
          ? "This device will be told. The four below follow you everywhere you sign in; the switch is for this device alone."
          : "Everything the league knows happens while nobody is looking at it. Turn this on and it will tell you."}
      </p>

      <button
        onClick={() => void (on ? turnOff() : turnOn())}
        disabled={busy}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          width: "100%",
          minHeight: 44,
          padding: "10px 14px",
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${on ? "rgb(var(--good-rgb) / .55)" : "rgb(var(--accent-bright-rgb) / .6)"}`,
          background: on ? "rgb(var(--good-rgb) / .1)" : "transparent",
          color: on ? "var(--good)" : "var(--accent-text)",
          font: "inherit",
          fontSize: 12.5,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {on ? "Notifications are on for this device" : "Turn on notifications"}
        <span aria-hidden style={{ fontSize: 11 }}>{on ? "ON" : "→"}</span>
      </button>

      {/* Shown whether or not this device is on, because they are the
          manager's rather than the device's — somebody setting them here and
          installing the app later should find them already as they left them.
          Dimmed when nothing can act on them yet. */}
      <div style={{ marginTop: 14, opacity: on ? 1 : 0.55 }}>
        {KINDS.map((kind) => (
          <label
            key={kind.key}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 0",
              minHeight: 44,
              borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
              cursor: busy ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={prefs[kind.key]}
              disabled={busy}
              onChange={(e) => void save({ ...prefs, [kind.key]: e.target.checked })}
              style={{ accentColor: "var(--accent-solid)", marginTop: 2, cursor: "inherit" }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--text)" }}>
                {kind.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  lineHeight: 1.5,
                  marginTop: 2,
                }}
              >
                {kind.note}
              </span>
            </span>
          </label>
        ))}
      </div>

      {note ? (
        <div role="status" style={{ fontSize: 11.5, color: "var(--good)", marginTop: 12 }}>
          {note}
        </div>
      ) : null}
      {error ? (
        <div role="status" style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 12, lineHeight: 1.5 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
