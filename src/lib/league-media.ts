/** The bucket migration 0016 creates. */
export const MEDIA_BUCKET = "league-media";

/** What a browser will actually play, and what the picker offers. */
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/**
 * The ceiling on an intro film, in bytes.
 *
 * Not a technical limit so much as a kindness: twelve people are about to
 * fetch this at the same moment, several on a phone, and a 200MB title
 * sequence would still be buffering when the first pick was due. A minute of
 * 1080p at a sane bitrate is comfortably inside this.
 */
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

export function readableSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * Where a league's intro film is kept.
 *
 * The name carries the moment it was uploaded, so replacing one is an upload
 * to a fresh path rather than an overwrite. That matters twice: nothing has to
 * be deleted before the new file is known to be good, and a browser that has
 * the old file cached is never handed different bytes under the same address.
 */
export function introVideoPath(leagueId: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = (dot > 0 ? filename.slice(dot + 1) : "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${leagueId}/intro-${Date.now()}.${ext || "mp4"}`;
}
