"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { patchMe, useMe } from "@/lib/use-me";
import { squareImage } from "@/lib/square-image";
import TeamCrest from "./TeamCrest";
import { refreshLogos } from "@/lib/use-logos";

/**
 * The manager's own corner of the app: their crest, their team's name, their
 * PIN, and the way out.
 *
 * Everything here is a manager editing themselves, which is why none of it
 * goes near the league office. The panel only opens what it is asked to open —
 * a rename does not make you look at a PIN field — and each section says what
 * happened rather than closing on you, because "did that save?" is the whole
 * anxiety of a settings panel.
 */

type Section = "name" | "photo" | "pin" | null;

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
  padding: "10px 14px",
  border: "none",
  borderTop: "1px solid rgba(145,132,217,.14)",
  background: open ? "rgba(145,132,217,.12)" : "transparent",
  color: open ? "#d2cefd" : "#c9cbd8",
  font: "inherit",
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
});

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "7px 13px",
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

export default function ProfileMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  // Where the panel sits, measured from the button when it opens. The nav is
  // a horizontal scroller, which clips anything positioned inside it, so the
  // panel is rendered against the body and pointed back at the button.
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const [section, setSection] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [franchise, setFranchise] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const wrap = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  // Escape closes, and so does a click anywhere else — a panel that traps you
  // until you find its own close button is a panel people stop opening.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is not inside the button's wrapper any more, so both count
      // as "inside" for the purpose of not closing.
      if (wrap.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    // The measurement is only true for the layout it was taken in.
    const onResize = () => setOpen(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Nothing to be the profile of until somebody is signed in.
  if (me.status !== "signed-in" || !me.manager) return null;
  const manager = me.manager;

  function show(next: Section) {
    setError(null);
    setDone(null);
    setPreview(null);
    setSection((was) => (was === next ? null : next));
    if (next === "name") setFranchise(manager.franchise);
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

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      // Straight to the sign-in page, which is the site root. A hard
      // navigation rather than a router push, and the lint rule that prefers
      // one is wrong here: a soft navigation keeps every client cache on the
      // page — the session store behind this menu, the draft board, the
      // rosters — all of it fetched as the manager who just left.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  return (
    <div ref={wrap} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
          setOpen((was) => !was);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${manager.franchise} — your profile`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 2,
          border: "none",
          background: "transparent",
          font: "inherit",
          cursor: "pointer",
          borderRadius: "50%",
          outline: open ? "1px solid rgba(181,171,252,.6)" : undefined,
          outlineOffset: 2,
        }}
      >
        <TeamCrest franchise={manager.franchise} logo={manager.logo} size={30} />
      </button>

      {open ? (
        createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Your profile"
          style={{
            position: "fixed",
            top: anchor.top,
            right: anchor.right,
            width: 310,
            maxHeight: "min(78vh, 560px)",
            overflowY: "auto",
            zIndex: 60,
            border: "1px solid rgba(145,132,217,.3)",
            borderRadius: "var(--radius-lg)",
            background: "#1b1d2c",
            boxShadow: "0 18px 44px rgba(8,9,16,.6)",
            textAlign: "left",
            animation: "gl-fade 140ms ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 14px 13px" }}>
            <TeamCrest franchise={manager.franchise} logo={manager.logo} size={40} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 15,
                  color: "#e9e9ed",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {manager.franchise}
              </div>
              <div style={{ fontSize: 10, letterSpacing: ".18em", color: "#75798c", marginTop: 3 }}>
                {manager.slot}
                {manager.is_commissioner ? " · COMMISSIONER" : ""}
              </div>
            </div>
          </div>

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
              <label htmlFor="pm-franchise" style={label}>
                TEAM NAME
              </label>
              <input
                id="pm-franchise"
                value={franchise}
                onChange={(e) => setFranchise(e.target.value.slice(0, 40))}
                maxLength={40}
                style={field}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
                <button
                  onClick={() => void saveName()}
                  disabled={busy || !franchise.trim() || franchise.trim() === manager.franchise}
                  style={action(!busy && Boolean(franchise.trim()) && franchise.trim() !== manager.franchise)}
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
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <TeamCrest
                  franchise={manager.franchise}
                  logo={preview ?? manager.logo}
                  size={54}
                />
                <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.55 }}>
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
              <label htmlFor="pm-current" style={label}>
                CURRENT PIN
              </label>
              <input
                id="pm-current"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                autoComplete="current-password"
                type="password"
                style={field}
              />

              <label htmlFor="pm-next" style={{ ...label, marginTop: 11 }}>
                NEW PIN
              </label>
              <input
                id="pm-next"
                value={nextPin}
                onChange={(e) => setNextPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                autoComplete="new-password"
                type="password"
                style={field}
              />

              <p style={{ fontSize: 11, color: "#75798c", lineHeight: 1.55, margin: "10px 0 0" }}>
                Four digits. Your current one is asked for so a browser left
                open cannot lock you out of your own franchise.
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

          {/* ------------------------------------------------- sign out --- */}
          <button
            onClick={() => void signOut()}
            disabled={busy}
            style={{ ...rowButton(false), color: "#c98f8f", cursor: busy ? "default" : "pointer" }}
          >
            Sign out
          </button>
        </div>,
        document.body,
        )
      ) : null}
    </div>
  );
}
