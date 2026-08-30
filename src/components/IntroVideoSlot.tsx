"use client";

import { useRef, useState } from "react";
import { MEDIA_BUCKET, VIDEO_TYPES, readableSize } from "@/lib/league-media";
import { uploadWithProgress } from "@/lib/upload-with-progress";
import { browserClient } from "@/lib/supabase-browser";
import IntroVideo from "./IntroVideo";

/**
 * The commissioner's slot for the film that opens draft night.
 *
 * The file goes from this browser straight to storage and never through the
 * app's own server, which could not carry it: a serverless request body is a
 * few megabytes and an intro film is not. The server mints a one-shot upload
 * URL, the browser uses it, and then the server goes and checks the file is
 * really there before the league is told about it.
 *
 * Below the picker is the same player the room will use, on the same file. The
 * question this card exists to answer is not "did it upload" but "will it
 * play, here, with sound" — and the only honest way to answer that is to
 * watch it.
 */
export default function IntroVideoSlot({
  introVideo,
  onSaved,
}: {
  introVideo: string | null;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  // The way in when uploading is not available — a bucket that was never
  // created, a project with storage turned off — or when the film is already
  // hosted somewhere. Folded away, because it is the uncommon path.
  const [byAddress, setByAddress] = useState(false);
  const [address, setAddress] = useState("");
  const file = useRef<HTMLInputElement | null>(null);

  async function upload(chosen: File | undefined) {
    if (!chosen || busy) return;

    setError(null);
    setNotice(null);

    if (!VIDEO_TYPES.includes(chosen.type)) {
      return setError("That is not an MP4, WebM or MOV video.");
    }

    // No size check. Whether the film is too big is Supabase's question, and
    // it answers it in words worth passing on rather than pre-empting.

    setBusy(true);
    try {
      setProgress("Asking for somewhere to put it…");
      const ticket = await fetch("/api/admin/intro-video/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: chosen.name, type: chosen.type, size: chosen.size }),
      });
      const minted = await ticket.json().catch(() => ({}));
      if (!ticket.ok) throw new Error(minted.error ?? "Could not start the upload.");

      const total = readableSize(chosen.size);
      setProgress(`Uploading ${total}…`);

      try {
        await uploadWithProgress(minted.signedUrl, chosen, (fraction) =>
          setProgress(`Uploading ${total} — ${Math.round(fraction * 100)}%`),
        );
      } catch (direct) {
        // The hand-written request did not go through. Before giving up, try
        // the library's own call: it is maintained alongside the endpoint, and
        // if it also fails the message it gives is the one worth showing.
        setProgress(`Uploading ${total}…`);
        const { error: uploadError } = await browserClient()
          .storage.from(minted.bucket ?? MEDIA_BUCKET)
          .uploadToSignedUrl(minted.path, minted.token, chosen, { contentType: chosen.type });

        if (uploadError) {
          throw new Error(
            uploadError.message ||
              (direct instanceof Error ? direct.message : "The upload did not finish."),
          );
        }
      }

      setProgress("Checking it arrived…");
      const adopt = await fetch("/api/admin/intro-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: minted.path }),
      });
      const saved = await adopt.json().catch(() => ({}));
      if (!adopt.ok) throw new Error(saved.error ?? "Could not save the intro video.");

      setNotice("Intro saved. Watch it below to be sure it plays here.");
      onSaved();
    } catch (e) {
      let message = e instanceof Error ? e.message : "The upload did not finish.";

      // The one refusal worth translating: storage says the object is too big,
      // but not that the number is a project setting the commissioner owns and
      // can raise. Nothing in this app can lift it, so say where it lives.
      if (/exceed|too large|maximum allowed size|413/i.test(message)) {
        message = `${message} That ceiling is your project's Global file size limit, in Supabase under Storage → Settings — 50MB on the free plan, up to 500GB above it.`;
      }

      setError(message);
      // Storage was not there. Offer the other way in rather than leaving the
      // commissioner with an error and no next step.
      if (message.includes("Storage is not ready")) setByAddress(true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function saveAddress() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ introVideo: address }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not save that address.");
      else {
        setNotice("Intro saved. Watch it below to be sure it plays here.");
        setAddress("");
        setByAddress(false);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/intro-video", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not clear the intro video.");
      else {
        setNotice("Intro removed. The countdown runs straight into the room.");
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {watching && introVideo ? (
        <IntroVideo
          src={introVideo}
          onDone={() => setWatching(false)}
          caption="PREVIEW"
        />
      ) : null}

      <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Intro video</h6>
      <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
        Plays over the whole room the moment the countdown runs out, once per
        person, and can be skipped. Upload it here — MP4, WebM or MOV — and it
        goes straight from this browser to the league&rsquo;s storage without
        passing through the site, so a long film is no harder than a short one.
      </p>
      <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 14px" }}>
        Browsers will not start a video with sound until the person watching has
        clicked something, so the room may hear it muted with a button to turn
        the sound on. Watch it below, and walk through it again in the{" "}
        <a href="/draft/rehearsal" style={{ color: "#b5abfc" }}>
          rehearsal room
        </a>
        , before the night itself.
      </p>

      {error ? (
        <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 12 }}>{error}</div>
      ) : null}
      {notice ? (
        <div style={{ fontSize: 12, color: "#7fd1a8", marginBottom: 12 }}>{notice}</div>
      ) : null}
      {progress ? (
        <div style={{ fontSize: 12, color: "#9397ab", marginBottom: 12 }}>{progress}</div>
      ) : null}

      {introVideo ? (
        <video
          key={introVideo}
          src={introVideo}
          controls
          preload="metadata"
          playsInline
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(145,132,217,.24)",
            background: "#0d0e17",
            display: "block",
            marginBottom: 13,
          }}
        />
      ) : null}

      <input
        ref={file}
        type="file"
        accept={VIDEO_TYPES.join(",")}
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => file.current?.click()} disabled={busy} style={action(!busy)}>
          {introVideo ? "Replace the film" : "Upload a film"}
        </button>

        {introVideo ? (
          <>
            <button onClick={() => setWatching(true)} disabled={busy} style={action(!busy)}>
              Watch it as the room will
            </button>
            <button
              onClick={() => void clear()}
              disabled={busy}
              style={{ ...action(!busy), border: "1px solid rgba(224,131,131,.45)", color: "#c98f8f" }}
            >
              Remove
            </button>
          </>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => setByAddress((was) => !was)}
          style={{
            border: "none",
            background: "transparent",
            color: "#75798c",
            font: "inherit",
            fontSize: 11.5,
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {byAddress ? "Never mind — upload a file" : "Or point at a film already online"}
        </button>

        {byAddress ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 9px" }}>
              An https address, or a path inside this site like{" "}
              <code style={{ color: "#9397ab" }}>/assets/intro.mp4</code> for a file
              committed to the repository. Use this if uploading is not working —
              nothing else about the intro changes.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="https://… or /assets/intro.mp4"
                aria-label="Intro video address"
                style={{
                  flex: "1 1 260px",
                  padding: "8px 10px",
                  background: "rgba(20,22,35,.8)",
                  border: "1px solid rgba(145,132,217,.3)",
                  borderRadius: "var(--radius-sm)",
                  color: "#e9e9ed",
                  font: "inherit",
                  fontSize: 13,
                }}
              />
              <button
                onClick={() => void saveAddress()}
                disabled={busy || !address.trim()}
                style={action(!busy && Boolean(address.trim()))}
              >
                Save
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});
