/**
 * Sending a notice as email.
 *
 * Deliberately no dependency. Resend's API is one POST with a JSON body, and a
 * package to wrap that is a package to keep up to date, audit and explain — for
 * twenty lines. Everything else in this app that talks to somebody else's
 * server does it with fetch and parses defensively; so does this.
 *
 * Nothing here is required for the league to work. With no key set, mail is
 * simply off: notices stay in the bell where they have always been, and the
 * cron route says so rather than failing. Turning email on should be a
 * deliberate act, not something a deployment discovers about itself.
 */

const ENDPOINT = process.env.RESEND_API_BASE ?? "https://api.resend.com/emails";

/** Whether this deployment can send at all. */
export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export interface NoticeMail {
  noticeId: string;
  email: string;
  franchise: string;
  kind: string;
  body: string;
  href: string | null;
}

export interface SendResult {
  /** Notices that reached the provider. */
  sent: string[];
  /** Notices that did not, and must be handed back so they are tried again. */
  failed: string[];
}

/**
 * The subject line.
 *
 * A subject is read in a list of thirty other subjects, so it says what
 * happened and to whom — "Gridiron Legacy" alone is indistinguishable from the
 * last four. The franchise is in it because a manager may run one in more than
 * one league, and the kind is in it because "you are on the clock" and "your
 * claim went through" want different urgency from the same reader.
 */
export function subjectFor(mail: NoticeMail): string {
  const headline: Record<string, string> = {
    draft_turn: "You are on the clock",
    draft_soon: "The draft is about to start",
    trade_offer: "You have a trade offer",
    trade_accepted: "Your trade went through",
    trade_declined: "Your trade was declined",
    waiver_won: "You won a waiver claim",
    waiver_lost: "Your waiver claim did not go through",
    lineup_hole: "Your lineup has a hole in it",
  };

  return `${headline[mail.kind] ?? "Something happened in your league"} — ${mail.franchise}`;
}

/** Where a notice points, as an address that works from an inbox. */
function link(href: string | null): string | null {
  const base = process.env.SITE_URL?.replace(/\/+$/, "");
  if (!base || !href) return null;
  return href.startsWith("/") ? `${base}${href}` : null;
}

/**
 * The body, in both the shapes a mail client might read.
 *
 * Plain text is not a courtesy here — a message with no text part is scored as
 * spam by most filters, and this app has exactly twelve recipients whose
 * inboxes it cannot afford to be filtered out of.
 */
export function bodyFor(mail: NoticeMail): { text: string; html: string } {
  const url = link(mail.href);

  const text = [
    mail.body,
    url ? `\n${url}` : "",
    "\n\n—\nGridiron Legacy. Turn these off under Edit team.",
  ]
    .filter(Boolean)
    .join("");

  // Inline styles and a table-free layout: an email client is not a browser,
  // and half of them will drop a stylesheet on the floor.
  const html = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`,
    `max-width:520px;margin:0 auto;padding:24px;color:#1c1d2a;line-height:1.6">`,
    `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;`,
    `color:#83859c;margin:0 0 12px">${escape(mail.franchise)}</p>`,
    `<p style="font-size:16px;margin:0 0 18px">${escape(mail.body)}</p>`,
    url
      ? `<p style="margin:0 0 24px"><a href="${escape(url)}" style="display:inline-block;` +
        `background:#5b4bc4;color:#fff;text-decoration:none;padding:10px 18px;` +
        `border-radius:4px;font-size:14px">Open Gridiron Legacy</a></p>`
      : "",
    `<p style="font-size:12px;color:#83859c;margin:24px 0 0;border-top:1px solid #ddd9ec;`,
    `padding-top:12px">You are getting this because your franchise has an email `,
    `address on it. Turn these off under Edit team.</p>`,
    `</div>`,
  ].join("");

  return { text, html };
}

/** The five characters that turn a franchise name into markup. */
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sends a batch, one message at a time.
 *
 * One at a time rather than a single call with twelve recipients, because
 * these are not the same message: each names a franchise and links to that
 * manager's own page. It also means one bad address costs one delivery instead
 * of the batch.
 *
 * Every failure is collected rather than thrown. The caller hands the failures
 * back to the database so the next run tries again, and a provider having a bad
 * afternoon costs some delay rather than the notices themselves.
 */
export async function sendNoticeMail(batch: NoticeMail[]): Promise<SendResult> {
  const sent: string[] = [];
  const failed: string[] = [];

  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { sent, failed: batch.map((m) => m.noticeId) };

  for (const mail of batch) {
    const { text, html } = bodyFor(mail);

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [mail.email],
          subject: subjectFor(mail),
          text,
          html,
        }),
      });

      if (res.ok) sent.push(mail.noticeId);
      else {
        // The provider's own words, which is the only thing that makes a
        // bounced address or a rejected sending domain diagnosable.
        console.error(`[mail] ${res.status} for notice ${mail.noticeId}`, await res.text());
        failed.push(mail.noticeId);
      }
    } catch (err) {
      console.error(`[mail] send failed for notice ${mail.noticeId}`, err);
      failed.push(mail.noticeId);
    }
  }

  return { sent, failed };
}
