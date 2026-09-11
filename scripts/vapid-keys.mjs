/**
 * A matched VAPID key pair, for the environment.
 *
 *   node scripts/vapid-keys.mjs
 *
 * Prints the two lines to paste. Run it once: changing the pair afterwards
 * does not break anything permanently, but every browser that has already
 * subscribed did so against the old public key and its subscription stops
 * working — everybody has to turn notifications on again.
 *
 * The public half is handed to every browser that subscribes and is meant to
 * be. The private half signs the requests to the push service; anybody holding
 * it can send a notification to any device subscribed to this application, so
 * it belongs in the environment and nowhere else. In particular it must never
 * be given a NEXT_PUBLIC_ name, which would compile it into the bundle.
 */
import { webcrypto as crypto } from "node:crypto";

const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);

// Uncompressed P-256 point, which is the form both the browser and the push
// service expect — 0x04 followed by the two coordinates.
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
