"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The commissioner's undo for a draft that went wrong.
 *
 * It is deliberately two steps. The button itself does nothing but open a
 * dialog that says, in plain numbers, what is about to be thrown away — a
 * commissioner who meant to switch to the board view and missed has not just
 * wiped four rounds of picks.
 *
 * The trigger is rendered only for the commissioner, and the rule is enforced
 * again in SQL: this hides the control, it does not grant the right.
 */
export default function ResetDraft({
  picksMade,
  busy,
  onConfirm,
}: {
  picksMade: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement | null>(null);

  // Escape closes it, and the focus starts on Cancel rather than on the
  // button that destroys the draft.
  useEffect(() => {
    if (!open) return;
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          padding: "6px 13px",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          border: "1px solid rgba(224,131,131,.34)",
          background: "transparent",
          color: "#c98f8f",
          borderRadius: "var(--radius-sm)",
          font: "inherit",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        Reset draft
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-draft-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
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
              maxWidth: 460,
              width: "100%",
              padding: "26px 28px",
              border: "1px solid rgba(224,131,131,.3)",
              borderRadius: "var(--radius-lg)",
              background: "#1b1d2c",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: ".3em", color: "#c98f8f" }}>
              THIS CANNOT BE UNDONE
            </div>

            <h2
              id="reset-draft-title"
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 26,
                fontWeight: 500,
                margin: "9px 0 14px",
                letterSpacing: "-.02em",
              }}
            >
              Reset the draft?
            </h2>

            <p style={{ fontSize: 13, lineHeight: 1.75, color: "#9397ab", margin: "0 0 10px" }}>
              {picksMade === 1 ? "One pick is" : `All ${picksMade} picks are`} undone and every
              roster in the league is emptied. The board is redrawn at the league&rsquo;s current
              size and the room closes, ready to open again.
            </p>

            <p style={{ fontSize: 12, lineHeight: 1.7, color: "#75798c", margin: "0 0 22px" }}>
              Standing trade offers are declined and pending waiver claims cancelled, since the
              players they name go back into the pool. Draft queues are left alone.
            </p>

            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button
                ref={cancel}
                onClick={() => setOpen(false)}
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
                onClick={() => {
                  setOpen(false);
                  onConfirm();
                }}
                disabled={busy}
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
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                Reset the draft
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
