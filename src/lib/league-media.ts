/** The bucket migration 0016 creates. */
export const MEDIA_BUCKET = "league-media";

/** What a browser will actually play, and what the picker offers. */
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/*
 * There is no size limit here on purpose.
 *
 * There used to be, and it was this code inventing a rule that was not its to
 * invent. The real ceiling is the project's own Global file size limit in
 * Supabase's Storage settings — 50MB on the free plan, up to 500GB above it —
 * and a second guess in front of it could only ever refuse a film the project
 * would have accepted. When storage does refuse one, its answer is passed
 * through rather than replaced, because the fix lives in that settings page
 * and nowhere in here.
 */

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
