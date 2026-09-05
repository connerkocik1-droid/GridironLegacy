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
/**
 * Whether an address points at a QuickTime file.
 *
 * Not a refusal — a league on Safari is fine, and a commissioner may know
 * exactly what they are doing — but a warning worth making, because the
 * failure is silent until draft night and by then it is too late to re-encode
 * anything.
 */
/** What trying the address in a video element turned out to say. */
type Trial =
  | { state: "trying" }
  | { state: "plays"; detail: string }
  | { state: "failed"; detail: string }
  | { state: "slow"; detail: string };

function looksLikeQuickTime(address: string): boolean {
  const path = address.trim().split(/[?#]/)[0];
  return /\.mov$/i.test(path);
}

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
  const [address, setAddress] = useState("");
  const [trial, setTrial] = useState<Trial | null>(null);
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
        body: JSON.stringify({
          filename: chosen.name,
          type: chosen.type,
          size: chosen.size,
        }),
      });
      const minted = await ticket.json().catch(() => ({}));
      if (!ticket.ok)
        throw new Error(minted.error ?? "Could not start the upload.");

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
          .uploadToSignedUrl(minted.path, minted.token, chosen, {
            contentType: chosen.type,
          });

        if (uploadError) {
          throw new Error(
            uploadError.message ||
              (direct instanceof Error
                ? direct.message
                : "The upload did not finish."),
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
      if (!adopt.ok)
        throw new Error(saved.error ?? "Could not save the intro video.");

      setNotice("Intro saved. Watch it below to be sure it plays here.");
      onSaved();
    } catch (e) {
      let message =
        e instanceof Error ? e.message : "The upload did not finish.";

      // The one refusal worth translating: storage says the object is too big,
      // but not that the number is a project setting the commissioner owns and
      // can raise. Nothing in this app can lift it, so say where it lives.
      if (/exceed|too large|maximum allowed size|413/i.test(message)) {
        message = `${message} That ceiling is your project's Global file size limit, in Supabase under Storage → Settings — 50MB on the free plan, up to 500GB above it.`;
      }

      // Whatever went wrong, the link route below is untouched by it.
      setError(message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /**
   * Tries the address in a real video element, in this browser.
   *
   * Not a request to the server asking whether a file looks plausible — the
   * actual element the draft room uses, given the actual address, in the
   * actual browser. If it plays here it plays on the night, and if it does not
   * there is time to do something about it.
   */
  async function testAddress() {
    const src = address.trim();
    if (!src) return;

    setTrial({ state: "trying" });

    const verdict = await new Promise<Trial>((resolve) => {
      const el = document.createElement("video");
      el.preload = "metadata";
      el.muted = true;

      const done = (t: Trial) => {
        el.removeAttribute("src");
        el.load();
        clearTimeout(timer);
        resolve(t);
      };

      // A file without faststart makes the browser read a long way in before
      // it knows anything. Fifteen seconds is generous for a header and short
      // enough that the button does not feel broken.
      const timer = setTimeout(
        () =>
          done({
            state: "slow",
            detail:
              "Fifteen seconds and no answer. The file may be very large and not encoded to start early, or the host may be slow to hand it over.",
          }),
        15_000,
      );

      el.addEventListener("loadedmetadata", () =>
        done({
          state: "plays",
          detail: `${Math.round(el.duration)}s${
            el.videoWidth ? `, ${el.videoWidth}×${el.videoHeight}` : ""
          }`,
        }),
      );

      el.addEventListener("error", () =>
        done({
          state: "failed",
          detail:
            "The browser could not load or decode it. Almost always this is a page with a player on it rather than the video file itself — a share link from Jumpshare, Drive, Dropbox or YouTube does that. It can also be a codec this browser will not play.",
        }),
      );

      el.src = src;
    });

    setTrial(verdict);
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

      <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>Intro video</h6>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          lineHeight: 1.6,
          margin: "0 0 10px",
        }}
      >
        Plays over the whole room the moment the countdown runs out, once per
        person, and can be skipped. Upload it here — MP4, WebM or MOV — and it
        goes straight from this browser to the league&rsquo;s storage without
        passing through the site, so a long film is no harder than a short one.
      </p>
      <p
        style={{
          fontSize: 11.5,
          color: "var(--text-dim)",
          lineHeight: 1.6,
          margin: "0 0 14px",
        }}
      >
        Browsers will not start a video with sound until the person watching has
        clicked something, so the room may hear it muted with a button to turn
        the sound on. Watch it below, and walk through it again in the{" "}
        <a href="/draft/rehearsal" style={{ color: "var(--accent-link)" }}>
          rehearsal room
        </a>
        , before the night itself.
      </p>

      {error ? (
        <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div style={{ fontSize: 12, color: "var(--good)", marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}
      {progress ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {progress}
        </div>
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
            border: "1px solid rgb(var(--accent-rgb) / .24)",
            background: "var(--well)",
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
        <button
          onClick={() => file.current?.click()}
          disabled={busy}
          style={action(!busy)}
        >
          {introVideo ? "Replace the film" : "Upload a film"}
        </button>

        {introVideo ? (
          <>
            <button
              onClick={() => setWatching(true)}
              disabled={busy}
              style={action(!busy)}
            >
              Watch it as the room will
            </button>
            <button
              onClick={() => void clear()}
              disabled={busy}
              style={{
                ...action(!busy),
                border: "1px solid rgb(var(--bad-rgb) / .45)",
                color: "var(--bad)",
              }}
            >
              Remove
            </button>
          </>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid rgb(var(--accent-rgb) / .16)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".2em",
            color: "var(--text-dim)",
            marginBottom: 8,
          }}
        >
          OR LINK TO IT INSTEAD
        </div>

        <div>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              lineHeight: 1.6,
              margin: "0 0 9px",
            }}
          >
            A link has no size limit at all — uploading does, and it is not this
            app&rsquo;s to raise: Supabase caps a project&rsquo;s files at 50MB
            on the free plan. For a long film this is the easier road. The room
            plays it exactly the same way.
          </p>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.6,
              margin: "0 0 9px",
            }}
          >
            It must be a{" "}
            <strong style={{ color: "var(--text-muted)", fontWeight: 500 }}>
              direct link to the video file
            </strong>{" "}
            — one ending in .mp4 or .webm, or a share link set to serve the file
            itself. A YouTube or Vimeo page will not play here; those hand out a
            web page, not a video. Anything on this site works too, like{" "}
            <code style={{ color: "var(--text-muted)" }}>/assets/intro.mp4</code> for a
            file committed to the repository.
          </p>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.6,
              margin: "0 0 9px",
            }}
          >
            For a large file, encode it so it can start before it has finished
            downloading —{" "}
            <code style={{ color: "var(--text-muted)" }}>
              ffmpeg -i in.mp4 -movflags +faststart out.mp4
            </code>
            . Without that the browser downloads the whole thing before the
            first frame, which on draft night is a room full of people watching
            a blank screen.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setTrial(null);
              }}
              placeholder="https://… or /assets/intro.mp4"
              aria-label="Intro video address"
              style={{
                flex: "1 1 260px",
                padding: "8px 10px",
                background: "rgb(var(--sunken-rgb) / .8)",
                border: "1px solid rgb(var(--accent-rgb) / .3)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                font: "inherit",
                fontSize: 13,
              }}
            />
            <button
              onClick={() => void testAddress()}
              disabled={trial?.state === "trying" || !address.trim()}
              style={{
                ...action(trial?.state !== "trying" && Boolean(address.trim())),
                background: "transparent",
              }}
            >
              {trial?.state === "trying" ? "Trying…" : "Test it"}
            </button>
            <button
              onClick={() => void saveAddress()}
              disabled={busy || !address.trim()}
              style={action(!busy && Boolean(address.trim()))}
            >
              Save
            </button>
          </div>


          {trial && trial.state !== "trying" ? (
            <p
              style={{
                fontSize: 11.5,
                lineHeight: 1.6,
                margin: "9px 0 0",
                color: trial.state === "plays" ? "var(--good)" : "var(--warn)",
              }}
            >
              <strong style={{ fontWeight: 500 }}>
                {trial.state === "plays"
                  ? "It plays. "
                  : trial.state === "slow"
                    ? "No answer yet. "
                    : "It will not play. "}
              </strong>
              {trial.detail}
              {trial.state === "failed" ? (
                <>
                  {" "}
                  Paste the address into a browser tab on its own: if you get a
                  page with a player on it rather than the video starting or
                  downloading, it is the wrong kind of link.
                </>
              ) : null}
            </p>
          ) : null}

          {looksLikeQuickTime(address) ? (
            <p
              style={{
                fontSize: 11.5,
                color: "var(--warn)",
                lineHeight: 1.6,
                margin: "9px 0 0",
              }}
            >
              That is a <strong style={{ fontWeight: 500 }}>.mov</strong>.
              Safari plays those; Chrome and Firefox do not advertise QuickTime
              as a format they support, and a server that labels it{" "}
              <code style={{ color: "var(--text-muted)" }}>video/quicktime</code> will
              have most of your league downloading the file instead of watching
              it. Footage straight off a phone is usually HEVC as well, which
              Chrome and Firefox will not play in any container.
              <br />
              If the video inside is already H.264, swapping the container
              costs nothing and takes seconds —{" "}
              <code style={{ color: "var(--text-muted)" }}>
                ffmpeg -i in.mov -c copy -movflags +faststart out.mp4
              </code>
              . If it is HEVC it has to be re-encoded:{" "}
              <code style={{ color: "var(--text-muted)" }}>
                ffmpeg -i in.mov -c:v libx264 -crf 23 -c:a aac -movflags
                +faststart out.mp4
              </code>
              . It will still save if you link it anyway.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  border: "1px solid rgb(var(--accent-bright-rgb) / .6)",
  background: "transparent",
  color: "var(--accent-text)",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});
