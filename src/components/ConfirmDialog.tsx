"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * The dialog in front of anything that cannot be taken back.
 *
 * Two things it does that a browser confirm() cannot: it says in the league's
 * own numbers what is about to go, and for the worst of them it asks the
 * commissioner to type something. A typed word is not security — the rule is
 * enforced in SQL — it is a speed bump between "I meant to click the other
 * button" and a season nobody can get back.
 *
 * Focus starts on Cancel, Escape closes, and clicking the backdrop closes.
 */
export default function ConfirmDialog(props: {
  open: boolean;
  title: string;
  eyebrow?: string;
  confirmLabel: string;
  /** When set, the confirm button stays dead until this is typed exactly. */
  confirmWord?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  // Mounted only while open, so a half-typed confirmation from last time is
  // gone by construction rather than by an effect that clears it.
  if (!props.open) return null;
  return <Dialog {...props} />;
}

function Dialog({
  title,
  eyebrow = "THIS CANNOT BE UNDONE",
  confirmLabel,
  confirmWord,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  eyebrow?: string;
  confirmLabel: string;
  /** When set, the confirm button stays dead until this is typed exactly. */
  confirmWord?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const cancel = useRef<HTMLButtonElement | null>(null);
  const fieldId = useId();

  // onCancel is rebuilt on every parent render, so the listener reads it
  // through a ref rather than tearing itself down and rebinding each time.
  const cancelled = useRef(onCancel);
  useEffect(() => {
    cancelled.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelled.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = !busy && (!confirmWord || typed.trim() === confirmWord);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${fieldId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(10,11,19,.86)",
        backdropFilter: "blur(6px)",
        animation: "gl-fade 160ms ease",
      }}
    >
      <div
        style={{
          maxWidth: 470,
          width: "100%",
          padding: "26px 28px",
          border: "1px solid rgba(224,131,131,.3)",
          borderRadius: "var(--radius-lg)",
          background: "#1b1d2c",
          textAlign: "left",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: ".3em", color: "#c98f8f" }}>{eyebrow}</div>

        <h2
          id={`${fieldId}-title`}
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            fontWeight: 500,
            margin: "9px 0 14px",
            letterSpacing: "-.02em",
          }}
        >
          {title}
        </h2>

        {children}

        {confirmWord ? (
          <div style={{ margin: "18px 0 0" }}>
            <label
              htmlFor={fieldId}
              style={{ display: "block", fontSize: 10, letterSpacing: ".18em", color: "#75798c" }}
            >
              TYPE {confirmWord.toUpperCase()} TO CONFIRM
            </label>
            <input
              id={fieldId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              style={{
                width: "100%",
                marginTop: 7,
                padding: "9px 11px",
                background: "rgba(20,22,35,.8)",
                border: `1px solid ${ready ? "rgba(224,131,131,.55)" : "rgba(145,132,217,.3)"}`,
                borderRadius: "var(--radius-sm)",
                color: "#e9e9ed",
                font: "inherit",
                fontSize: 13,
              }}
            />
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 22 }}>
          <button
            ref={cancel}
            onClick={onCancel}
            style={{
              padding: "10px 20px",
              border: "1px solid rgba(145,132,217,.3)",
              background: "transparent",
              color: "#9397ab",
              borderRadius: "var(--radius-sm)",
              font: "inherit",
              fontSize: 12,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            disabled={!ready}
            style={{
              padding: "10px 20px",
              border: "1px solid rgba(224,131,131,.6)",
              background: "rgba(224,131,131,.14)",
              color: "#e5a3a3",
              borderRadius: "var(--radius-sm)",
              font: "inherit",
              fontSize: 12,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              cursor: ready ? "pointer" : "default",
              opacity: ready ? 1 : 0.4,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
