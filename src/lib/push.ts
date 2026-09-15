/**
 * Web Push, written out rather than installed.
 *
 * Two specifications and no dependency. RFC 8291 says how to encrypt a payload
 * so that only the subscriber's browser can read it, and RFC 8292 (VAPID) says
 * how to sign the request so the push service knows who is asking. Both are
 * built on primitives Web Crypto already has, which is why this is a file
 * rather than a package: the crypto is the standard library's, and what is
 * here is the twenty lines of plumbing around it.
 *
 * Verified against a round trip in push.test.mts — the same derivation run
 * backwards with the subscriber's private key has to return the plaintext, or
 * the notification would arrive as an undecryptable blob and the browser would
 * silently drop it.
 */

const enc = new TextEncoder();

/** The keys the app signs with. Both halves, or push is simply off. */
export interface VapidKeys {
  /** Base64url, uncompressed P-256 point. The browser is given this too. */
  publicKey: string;
  /** Base64url, the raw 32-byte scalar. Never leaves the server. */
  privateKey: string;
  /** Who to contact about this application server: a mailto: or https: URL. */
  subject: string;
}

/** What the browser handed us when it subscribed. */
export interface PushSubscription {
  endpoint: string;
  /** Base64url, the subscriber's uncompressed P-256 public key. */
  p256dh: string;
  /** Base64url, sixteen bytes of shared secret. */
  auth: string;
}

export function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * HKDF, in the one shape both specifications use.
 *
 * Extract with the salt, expand with an info string, take the first `length`
 * bytes. Web Crypto does the whole thing in one deriveBits, which is why there
 * is no HMAC here despite both RFCs describing it in those terms.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** A P-256 public key as the uncompressed 65-byte point every RFC here wants. */
async function rawPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

/**
 * The body of a push message: RFC 8188 aes128gcm, keyed as RFC 8291 says.
 *
 * The two derivations are easy to confuse and neither fails loudly when it is
 * wrong, so they are spelt out. First the subscriber's auth secret and the
 * ECDH shared secret make an input keying material that is specific to this
 * pair of keys. Then that, with a fresh salt, makes the content key and nonce.
 *
 * `senderKeys` and `salt` exist so a test can pin them. Left out, both are
 * fresh for every message, which is what a real send must do.
 */
export async function encryptPayload(
  payload: string,
  subscriber: { p256dh: string; auth: string },
  senderKeys?: CryptoKeyPair,
  fixedSalt?: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = base64urlToBytes(subscriber.p256dh);
  const authSecret = base64urlToBytes(subscriber.auth);

  const sender =
    senderKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair);

  const asPublic = await rawPublicKey(sender.publicKey);

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256),
  );

  // RFC 8291 §3.4. The info binds the key to both parties, so a message
  // encrypted for one subscriber cannot be replayed at another.
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(enc.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );

  const salt = fixedSalt ?? crypto.getRandomValues(new Uint8Array(16));

  // RFC 8188 §2.2. The trailing NUL is part of the info string, not a
  // terminator this code adds for tidiness — leaving it off derives a
  // different key and the browser drops the message without a word.
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);

  // One record, so its delimiter is 0x02 — "this is the last". A 0x01 here
  // says another record follows and the browser waits for one that never
  // comes.
  const record = concat(enc.encode(payload), new Uint8Array([2]));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
      key,
      record as BufferSource,
    ),
  );

  // The header the body carries in front of itself: salt, record size, and
  // the sender's public key as the key id, so the browser can do all of the
  // above in reverse with nothing but the message.
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, Math.max(sealed.length + 16, 4096), false);

  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/** The origin a VAPID token is good for: scheme and host of the endpoint. */
function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

/**
 * The signed token that says which application server is asking.
 *
 * ES256 over a JWT, with one wrinkle worth knowing: Web Crypto returns the
 * signature as the raw r‖s pair a JWT wants, where most other tooling returns
 * it DER-wrapped. Nothing to unwrap here — but anything comparing this against
 * an OpenSSL signature will see two different-looking correct answers.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const header = bytesToBase64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64url(
    enc.encode(
      JSON.stringify({
        aud: audienceOf(endpoint),
        // Twelve hours. The maximum a push service will accept is twenty-four,
        // and a token that expires while a batch is in flight is a delivery
        // lost for no reason.
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );

  const signingKey = await importVapidPrivateKey(keys);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      enc.encode(`${header}.${claims}`) as BufferSource,
    ),
  );

  return `vapid t=${header}.${claims}.${bytesToBase64url(signature)}, k=${keys.publicKey}`;
}

/**
 * The signing key, rebuilt from the two halves stored in the environment.
 *
 * Web Crypto will not import a bare P-256 scalar, so it goes in as a JWK with
 * the public point beside it — which is also a check worth having: a private
 * key that does not belong to the configured public key is refused here rather
 * than producing tokens every push service rejects.
 */
async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = base64urlToBytes(keys.publicKey);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID public key must be an uncompressed P-256 point");
  }

  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64url(point.slice(1, 33)),
      y: bytesToBase64url(point.slice(33, 65)),
      d: keys.privateKey.replace(/-/g, "-"),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** What happened to one message. */
export interface PushResult {
  ok: boolean;
  status: number;
  /**
   * The subscription is dead and should be deleted rather than retried. A
   * browser that has been uninstalled, or a permission the manager revoked.
   */
  gone: boolean;
}

/**
 * One notification to one device.
 *
 * Never throws for a refusal: a push service being down, or one subscription
 * out of twelve having expired, is an ordinary Tuesday and must not take the
 * rest of the batch with it.
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: unknown,
  keys: VapidKeys,
  ttlSeconds = 4 * 60 * 60,
): Promise<PushResult> {
  try {
    const body = await encryptPayload(JSON.stringify(payload), subscription);
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, keys),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttlSeconds),
        // Loud enough to wake a phone. The alternative, "normal", lets the
        // service hold it until the device is next awake anyway — which for a
        // score during a game is the same as not sending it.
        Urgency: "high",
      },
      body: body as BodyInit,
    });

    return {
      ok: res.ok,
      status: res.status,
      // 404 the endpoint never existed, 410 it has been revoked. Both mean
      // this row is rubbish; everything else is worth another go.
      gone: res.status === 404 || res.status === 410,
    };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

/** The configured keys, or null when push is not set up. */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    // A push service wants somebody to complain to. The league's own address
    // if it has one, and a harmless default if not — this is a contact, not a
    // credential, and an absent one is not worth turning push off for.
    subject: process.env.VAPID_SUBJECT || "mailto:commissioner@example.com",
  };
}

export function isPushConfigured(): boolean {
  return vapidKeys() != null;
}
