"use client";

import { useRef, useState } from "react";
import { squareImage } from "@/lib/square-image";
import { refreshReportLogos } from "@/lib/use-report-logos";

/**
 * A school or team crest, in the commissioner's desk: the abbreviation tile
 * until something is dropped on it, then the crest itself. Click or drop
 * either one, same handler — a "drop box" is a click target that also
 * accepts a drop, not a different control.
 *
 * CFB and the Pylon 50 share the 'cfb' scope, so this is the only place a
 * school's crest is ever set — the Pylon 50 desk just displays what was
 * uploaded here.
 */
export default function ReportLogoSlot({
  scope,
  abbr,
  image,
}: {
  scope: "cfb" | "nfl";
  abbr: string;
  image: string | undefined;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(chosen: File | undefined) {
    if (!chosen || !abbr || busy) return;
    setBusy(true);
    setError(null);
    try {
      const squared = await squareImage(chosen);
      const res = await fetch("/api/report-logos", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, abbr, image: squared }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save that crest.");
      } else {
        await refreshReportLogos();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={!abbr || busy}
        title={abbr ? `Set ${abbr}'s crest` : "Give this row an abbreviation first"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        style={{
          width: 32,
          height: 32,
          padding: 0,
          cursor: abbr ? "pointer" : "default",
          borderRadius: 3,
          border: `1px ${over ? "dashed" : "solid"} rgb(var(--accent-rgb) / ${over ? 0.6 : 0.25})`,
          background: image ? `url(${image}) center / cover` : "rgb(var(--accent-rgb) / .12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: ".04em",
          color: "var(--accent-text)",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {image ? null : abbr}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />
      {error ? (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 1, width: 140, marginTop: 4, fontSize: 10, lineHeight: 1.4, color: "var(--warn)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
