"use client";

import { useRef, useState } from "react";
import { patchMe } from "@/lib/use-me";
import { squareImage } from "@/lib/square-image";
import { refreshLogos } from "@/lib/use-logos";
import TeamCrest from "./TeamCrest";

/**
 * The three things a manager can change about their own franchise: its name,
 * its picture, and the PIN they sign in with.
 *
 * Lives on its own so the panel behind the crest in the nav and the Edit Team
 * page under My Team are the same code rather than two versions of it that
 * drift. A settings screen that saves differently depending on where you
 * opened it is the sort of bug nobody finds for a season.
 *
 * Sections open one at a time and stay open after saving, because "did that
 * work?" is the whole anxiety of a settings panel and a form that closes on
 * you answers it with a shrug.
 */

export interface EditableManager {
  franchise: string;
  logo: string | null;
  /** Where the league emails them, or null if they have never said. */
  email?: string | null;
  email_notices?: boolean;
}

type Section = "name" | "photo" | "email" | "pin" | null;

const label: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
  marginBottom: 6,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.3)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 13,
};

const rowButton = (open: boolean): React.CSSProperties => ({
  display: "flex",
  width: "100%",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 14px",
  minHeight: 34,
  border: "none",
  borderTop: "1px solid rgba(145,132,217,.14)",
  background: open ? "rgba(145,132,217,.12)" : "transparent",
  color: open ? "#d2cefd" : "#c9cbd8",
  font: "inherit",
  fontSize: 12.5,
  textAlign: "left",
  cursor: "pointer",
});

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 13px",
  minHeight: 34,
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 11,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

export default function TeamSettings({ manager }: { manager: EditableManager }) {
  const [section, setSection] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [franchise, setFranchise] = useState("");
  const [email, setEmail] = useState("");
  const [wantsMail, setWantsMail] = useState(true);
  const [currentPin, setCurrentPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const file = useRef<HTMLInputElement | null>(null);

  function show(next: Section) {
    setError(null);
    setDone(null);
    setPreview(null);
    setSection((was) => (was === next ? null : next));
    if (next === "name") setFranchise(manager.franchise);
    if (next === "email") {
      setEmail(manager.email ?? "");
      setWantsMail(manager.email_notices !== false);
    }
    if (next === "pin") {
      setCurrentPin("");
      setNextPin("");
    }
  }

  async function send(
    run: () => Promise<Response>,
    onOk: (body: Record<string, unknown>) => void,
    fallback: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await run();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof body.error === "string" ? body.error : fallback);
      else onOk(body);
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  const saveName = () =>
    send(
      () =>
        fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ franchise }),
        }),
      (body) => {
        // Pushed straight into the shared session, so the name beside the
        // crest changes as the request lands rather than on the next reload.
        patchMe({ franchise: String(body.franchise ?? franchise) });
        setDone("Team name saved.");
      },
      "Could not save that name.",
    );

  /**
   * The address and the switch save together, because they are one decision.
   * Somebody typing an address wants the emails; somebody clearing it does not,
   * and making them press two buttons to say so is a form arguing with them.
   */
  const saveEmail = () =>
    send(
      () =>
        fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: email.trim(), emailNotices: wantsMail }),
        }),
      (body) => {
        patchMe({
          email: (body.email as string | null) ?? null,
          email_notices: body.emailNotices !== false,
        });
        setDone(
          email.trim()
            ? wantsMail
              ? "Saved. The league will email you when something happens."
              : "Saved. Your address is kept, but nothing will be emailed."
            : "Saved. Nothing will be emailed to you.",
        );
      },
      "Could not save that address.",
    );

  const savePin = () =>
    send(
      () =>
        fetch("/api/auth/pin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ current: currentPin, next: nextPin }),
        }),
      () => {
        setCurrentPin("");
        setNextPin("");
        setDone("PIN changed. It is what you sign in with from now on.");
      },
      "Could not change your PIN.",
    );

  const savePhoto = () =>
    send(
      () =>
        fetch("/api/profile/logo", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: preview }),
        }),
      () => {
        void refreshLogos();
        patchMe({ logo: preview });
        setPreview(null);
        setDone("Team photo saved.");
      },
      "Could not save that picture.",
    );

  const removePhoto = () =>
    send(
      () => fetch("/api/profile/logo", { method: "DELETE" }),
      () => {
        void refreshLogos();
        patchMe({ logo: null });
        setPreview(null);
        setDone("Team photo removed.");
      },
      "Could not remove that picture.",
    );

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    setDone(null);
    try {
      // Squared and shrunk here, so a phone photograph never crosses the wire.
      setPreview(await squareImage(chosen));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Could not read that picture.");
    }
  }

  return (
    <>
      {error ? (
        <div style={{ padding: "0 14px 10px", fontSize: 11.5, color: "#e0b573" }}>{error}</div>
      ) : null}
      {done ? (
        <div style={{ padding: "0 14px 10px", fontSize: 11.5, color: "#7fd1a8" }}>{done}</div>
      ) : null}

      {/* ------------------------------------------------ team name --- */}
      <button onClick={() => show("name")} style={rowButton(section === "name")}>
        Change team name
        <span aria-hidden style={{ color: "#75798c" }}>{section === "name" ? "−" : "+"}</span>
      </button>

      {section === "name" ? (
        <div style={{ padding: "12px 14px 14px" }}>
          <label htmlFor="ts-franchise" style={label}>
            TEAM NAME
          </label>
          <input
            id="ts-franchise"
            value={franchise}
            onChange={(e) => setFranchise(e.target.value.slice(0, 40))}
            maxLength={40}
            style={field}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
            <button
              onClick={() => void saveName()}
              disabled={busy || !franchise.trim() || franchise.trim() === manager.franchise}
              style={action(
                !busy && Boolean(franchise.trim()) && franchise.trim() !== manager.franchise,
              )}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------- email --- */}
      {/* Between the name and the photo, because it is the other thing that
          is about the manager rather than about the team. */}
      <button onClick={() => show("email")} style={rowButton(section === "email")}>
        Email me when something happens
        <span aria-hidden style={{ color: "#75798c" }}>{section === "email" ? "\u2212" : "+"}</span>
      </button>

      {section === "email" ? (
        <div style={{ padding: "12px 14px 14px" }}>
          <p style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.6, margin: "0 0 12px" }}>
            The league already tells you things in the bell at the top of the
            page. Give an address and it will tell you by email as well &mdash;
            when you are on the clock, when somebody offers you a trade, when a
            claim goes through, when a week is settled. Leave it blank and
            nothing is sent.
          </p>

          <label htmlFor="ts-email" style={label}>
            EMAIL ADDRESS
          </label>
          <input
            id="ts-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 200))}
            placeholder="you@example.com"
            style={field}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginTop: 12,
              minHeight: 34,
              fontSize: 12,
              color: "#c8ccdc",
              cursor: email.trim() ? "pointer" : "default",
              opacity: email.trim() ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={wantsMail}
              disabled={!email.trim()}
              onChange={(e) => setWantsMail(e.target.checked)}
              style={{ accentColor: "#9184d9", cursor: "inherit" }}
            />
            Send them
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
            <button
              onClick={() => void saveEmail()}
              disabled={busy}
              style={action(!busy)}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------- team photo --- */}
      <button onClick={() => show("photo")} style={rowButton(section === "photo")}>
        Change team photo
        <span aria-hidden style={{ color: "#75798c" }}>{section === "photo" ? "−" : "+"}</span>
      </button>

      {section === "photo" ? (
        <div style={{ padding: "12px 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <TeamCrest franchise={manager.franchise} logo={preview ?? manager.logo} size={54} />
            <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.55, flex: 1, minWidth: 0 }}>
              {preview
                ? "This is how it will look. Save it to make it yours."
                : "A square is taken from the middle and shrunk to 256 pixels, on this machine — the original never leaves it."}
            </div>
          </div>

          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              // Cleared so picking the same file twice still fires.
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />

          <div style={{ display: "flex", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
            <button onClick={() => file.current?.click()} disabled={busy} style={action(!busy)}>
              Choose a picture
            </button>
            {preview ? (
              <button onClick={() => void savePhoto()} disabled={busy} style={action(!busy)}>
                Save
              </button>
            ) : null}
            {manager.logo && !preview ? (
              <button
                onClick={() => void removePhoto()}
                disabled={busy}
                style={{
                  ...action(!busy),
                  border: "1px solid rgba(224,131,131,.45)",
                  color: "#c98f8f",
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------ PIN --- */}
      <button onClick={() => show("pin")} style={rowButton(section === "pin")}>
        Change PIN
        <span aria-hidden style={{ color: "#75798c" }}>{section === "pin" ? "−" : "+"}</span>
      </button>

      {section === "pin" ? (
        <div style={{ padding: "12px 14px 14px" }}>
          <label htmlFor="ts-current" style={label}>
            CURRENT PIN
          </label>
          <input
            id="ts-current"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="current-password"
            type="password"
            style={field}
          />

          <label htmlFor="ts-next" style={{ ...label, marginTop: 11 }}>
            NEW PIN
          </label>
          <input
            id="ts-next"
            value={nextPin}
            onChange={(e) => setNextPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="new-password"
            type="password"
            style={field}
          />

          <p style={{ fontSize: 11, color: "#75798c", lineHeight: 1.55, margin: "10px 0 0" }}>
            Four digits. Your current one is asked for so a browser left open
            cannot lock you out of your own franchise.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
            <button
              onClick={() => void savePin()}
              disabled={busy || currentPin.length !== 4 || nextPin.length !== 4}
              style={action(!busy && currentPin.length === 4 && nextPin.length === 4)}
            >
              Change it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
