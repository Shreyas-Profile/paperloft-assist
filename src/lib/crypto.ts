// Symmetric encryption helper for at-rest secrets that only THIS server
// needs to decrypt — currently only BYO-skill auth headers.
//
// Uses AES-256-GCM with a random 12-byte IV per ciphertext. Output layout:
//   `<ivHex>:<authTagHex>:<ciphertextHex>`
// (colon-delimited hex — cheap to store as TEXT, easy to eyeball in logs.)
//
// Env: `USER_SKILL_ENCRYPTION_KEY` must be 64 hex chars = 32 bytes.
// Generate once: `openssl rand -hex 32`. NEVER rotate — rotating breaks
// every stored ciphertext. Missing/wrong length throws at first call.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";

const ALGO: CipherGCMTypes = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.USER_SKILL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "USER_SKILL_ENCRYPTION_KEY not set — generate with `openssl rand -hex 32` and add to .env",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `USER_SKILL_ENCRYPTION_KEY must be ${KEY_LENGTH_BYTES * 2} hex chars (got ${raw.length})`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("malformed ciphertext (expected iv:tag:ct)");
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
