/**
 * Turning a notice into an email.
 *
 * Three things have to hold, and the third is the one that bites. A subject
 * has to be readable in a list of thirty other subjects. A body has to carry a
 * plain-text part, because a message without one is scored as spam and this
 * app has exactly twelve addresses it cannot afford to be filtered out of. And
 * a franchise name is typed by a manager, so it reaches the HTML as text
 * rather than as markup — "Steve's <b>Team</b>" must not be able to close a
 * tag, and the same names that stress this app's layout are the ones that
 * would do it.
 */

import { bodyFor, isMailConfigured, sendNoticeMail, subjectFor, type NoticeMail } from "../mail";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

const notice = (over: Partial<NoticeMail> = {}): NoticeMail => ({
  noticeId: "n1",
  email: "manager@example.com",
  franchise: "Steel Cartel",
  kind: "draft_turn",
  body: "You are on the clock, with 90 seconds.",
  href: "/draft",
  ...over,
});

console.log("--- the subject line ---");

eq(
  "says what happened and to which team",
  subjectFor(notice()),
  "You are on the clock — Steel Cartel",
);
eq(
  "a trade offer reads as one",
  subjectFor(notice({ kind: "trade_offer" })),
  "You have a trade offer — Steel Cartel",
);
eq(
  "and a kind nobody has written a line for still reads as a sentence",
  subjectFor(notice({ kind: "something_new" })),
  "Something happened in your league — Steel Cartel",
);

console.log("\n--- the body ---");

process.env.SITE_URL = "https://pylon.example.com";
const both = bodyFor(notice());

ok("carries the notice itself", both.text.includes("You are on the clock"));
ok("as plain text, which is what keeps it out of a spam folder", both.text.length > 0);
ok("and as html", both.html.includes("<div"));
ok("with a link back", both.text.includes("https://pylon.example.com/draft"));
ok("and a button in the html", both.html.includes('href="https://pylon.example.com/draft"'));
ok("saying how to stop them", /turn these off/i.test(both.text));

// A trailing slash on the site URL must not produce a double slash in a link
// somebody is going to click.
process.env.SITE_URL = "https://pylon.example.com/";
ok(
  "a trailing slash does not become a double one",
  bodyFor(notice()).text.includes("https://pylon.example.com/draft"),
);

// No site URL means no link rather than a broken relative one in an inbox.
delete process.env.SITE_URL;
const linkless = bodyFor(notice());
ok("with no site address, no link is invented", !linkless.text.includes("/draft"));
ok("and the notice still says what happened", linkless.text.includes("on the clock"));
process.env.SITE_URL = "https://pylon.example.com";

console.log("\n--- a franchise name is somebody's typing ---");

const hostile = bodyFor(notice({ franchise: 'Steve\'s <b>Team</b> & "Co"' }));
ok("angle brackets cannot open a tag", !hostile.html.includes("<b>Team</b>"));
ok("they are escaped instead", hostile.html.includes("&lt;b&gt;Team&lt;/b&gt;"));
ok("and so is an ampersand", hostile.html.includes("&amp;"));
ok("and a quote, which could close an attribute", hostile.html.includes("&quot;"));

// The notice body is written by the app rather than by a manager, but it
// carries player and franchise names, so it goes through the same escape.
const inBody = bodyFor(notice({ body: "Kim offered you <script>alert(1)</script>" }));
ok("a script tag in the body is text, not script", !inBody.html.includes("<script>"));

console.log("\n--- when mail is not configured ---");

const key = process.env.RESEND_API_KEY;
const from = process.env.MAIL_FROM;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

ok("the app knows it cannot send", !isMailConfigured());

// Nothing is reported sent, so nothing is marked delivered — the notices stay
// in the queue rather than disappearing into a provider that was never there.
const nowhere = await sendNoticeMail([notice(), notice({ noticeId: "n2" })]);
eq("nothing is claimed as sent", nowhere.sent, []);
eq("and everything comes back to be tried again", nowhere.failed, ["n1", "n2"]);

process.env.RESEND_API_KEY = "test-key";
process.env.MAIL_FROM = "league@example.com";
ok("with a key and a sender it is configured", isMailConfigured());

console.log("\n--- sending, against a provider that is having a bad day ---");

// One address rejected must not cost the rest of the batch: these are twelve
// different messages to twelve different people, not one message to twelve.
const { createServer } = await import("node:http");
const seen: string[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    seen.push(body.to?.[0] ?? "");
    const bad = body.to?.[0] === "bounces@example.com";
    res.writeHead(bad ? 422 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(bad ? { message: "invalid address" } : { id: "sent" }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const addr = server.address();
process.env.RESEND_API_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const { sendNoticeMail: send } = await import("../mail.ts?live");

const mixed = await send([
  notice({ noticeId: "good-1" }),
  notice({ noticeId: "bad-1", email: "bounces@example.com" }),
  notice({ noticeId: "good-2" }),
]);

eq("the ones that went, went", mixed.sent, ["good-1", "good-2"]);
eq("the one that bounced comes back for another try", mixed.failed, ["bad-1"]);
eq("and each was sent on its own, not as one message to three", seen.length, 3);

server.close();
if (key) process.env.RESEND_API_KEY = key; else delete process.env.RESEND_API_KEY;
if (from) process.env.MAIL_FROM = from; else delete process.env.MAIL_FROM;

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
