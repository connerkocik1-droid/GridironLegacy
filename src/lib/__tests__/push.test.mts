import {
  base64urlToBytes,
  bytesToBase64url,
  encryptPayload,
  vapidAuthorization,
} from "../push";

/**
 * Does the encryption actually produce something a browser can open?
 *
 * There is no way to eyeball this. A payload encrypted with the wrong info
 * string, the wrong record delimiter or the wrong nonce is a well-formed
 * blob of the right length that the browser discards without a word — the
 * notification simply never arrives, and nothing anywhere says why.
 *
 * So the test is the other half of the specification: RFC 8291 run backwards
 * with the subscriber's private key. If the plaintext comes out, every step of
 * the derivation matched what a browser does. If any of them is wrong, it
 * cannot.
 */

let failed = 0;
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8),
  );
}

/**
 * A subscriber, the way a browser makes one: a P-256 pair it keeps the private
 * half of, and sixteen bytes of auth secret.
 */
async function subscriber() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;

  const p256dh = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));

  return {
    keys: { p256dh: bytesToBase64url(p256dh), auth: bytesToBase64url(auth) },
    raw: { p256dh, auth },
    privateKey: pair.privateKey,
  };
}

/** RFC 8291 and RFC 8188, backwards. This is what the browser does. */
async function decrypt(
  body: Uint8Array,
  me: Awaited<ReturnType<typeof subscriber>>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);

  const senderKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, me.privateKey, 256),
  );

  const ikm = await hkdf(
    me.raw.auth,
    shared,
    concat(enc.encode("WebPush: info\0"), me.raw.p256dh, asPublic),
    32,
  );

  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, sealed),
  );

  // The last byte is the record delimiter, not content. A browser checks it:
  // 0x02 says this is the last record, 0x01 says another follows and it waits
  // for one that never comes. Returned so a test can assert it rather than
  // quietly discarding the byte that decides whether anything is shown.
  return JSON.stringify({ text: dec.decode(record.slice(0, -1)), delimiter: record.at(-1) });
}

/** Just the plaintext, for the cases that are only about the plaintext. */
async function plaintext(body: Uint8Array, me: Awaited<ReturnType<typeof subscriber>>) {
  return JSON.parse(await decrypt(body, me)).text as string;
}

console.log("--- base64url, which everything here is spoken in ---");
{
  const bytes = new Uint8Array([251, 239, 190, 0, 1, 2]);
  eq("a round trip returns the same bytes", [...base64urlToBytes(bytesToBase64url(bytes))], [...bytes]);
  ok("and never uses the characters a URL would eat",
    !/[+/=]/.test(bytesToBase64url(crypto.getRandomValues(new Uint8Array(64)))));
  eq("padding a browser omitted is supplied", [...base64urlToBytes("AQID")], [1, 2, 3]);
}

console.log("\n--- a payload the subscriber can open ---");
{
  const me = await subscriber();
  const message = JSON.stringify({ title: "Steel Cartel 104.6", body: "You are up by 11." });

  const body = await encryptPayload(message, me.keys);
  eq("the message comes back out the other side", await plaintext(body, me), message);

  // 0x02, or the browser holds the record waiting for one that never arrives
  // and shows nothing at all.
  eq("and the record says it is the last one", JSON.parse(await decrypt(body, me)).delimiter, 2);
}

console.log("\n--- and the envelope is shaped the way the browser reads it ---");
{
  const me = await subscriber();
  const body = await encryptPayload("hello", me.keys);

  eq("sixteen bytes of salt, four of record size, one of key length", body[20], 65);
  ok("the key id is an uncompressed P-256 point", body[21] === 4);
  ok("the record size is at least the record", new DataView(body.buffer, body.byteOffset).getUint32(16) >= body.length - 86);

  // Two messages must never share a salt or a sender key. Reusing either with
  // the same content key is the classic way to lose a stream cipher.
  const again = await encryptPayload("hello", me.keys);
  ok("no two messages share a salt", bytesToBase64url(body.slice(0, 16)) !== bytesToBase64url(again.slice(0, 16)));
  ok("nor a sender key", bytesToBase64url(body.slice(21, 86)) !== bytesToBase64url(again.slice(21, 86)));
}

console.log("\n--- non-ASCII, which a franchise name is full of ---");
{
  const me = await subscriber();
  const message = JSON.stringify({ title: "Kim's XI — 104.6", body: "Ja'Marr Chase · 31.2" });
  eq("survives the round trip byte for byte",
    await plaintext(await encryptPayload(message, me.keys), me), message);
}

console.log("\n--- the token that says who is asking ---");
{
  // A known pair, so the test is not also testing key generation.
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const point = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

  const keys = {
    publicKey: bytesToBase64url(point),
    privateKey: jwk.d as string,
    subject: "mailto:commissioner@pylon.example",
  };

  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc123", keys);

  ok("it is a vapid authorization", header.startsWith("vapid t="));
  ok("carrying the public key the browser was given", header.includes(`k=${keys.publicKey}`));

  const token = header.slice("vapid t=".length, header.indexOf(", k="));
  const [h, c, s] = token.split(".");

  eq("signed with ES256", JSON.parse(new TextDecoder().decode(base64urlToBytes(h))),
    { typ: "JWT", alg: "ES256" });

  const claims = JSON.parse(new TextDecoder().decode(base64urlToBytes(c)));
  eq("addressed to the push service's origin, not the full endpoint",
    claims.aud, "https://fcm.googleapis.com");
  eq("and says who to complain to", claims.sub, keys.subject);
  ok("expiring inside the day a push service will accept",
    claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 60 * 60);

  // The signature has to verify against the public key the header advertises,
  // or every push service refuses the request.
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    base64urlToBytes(s),
    enc.encode(`${h}.${c}`),
  );
  ok("and the signature verifies against that key", verified);

  // Sixty-four bytes of r‖s, not a DER wrapper. A DER signature here is the
  // single most common way a hand-rolled VAPID header gets rejected.
  eq("as a raw r‖s pair rather than DER", base64urlToBytes(s).length, 64);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
