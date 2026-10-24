// Field-level encryption of 問診 answers and booking notes (N-PI-04): AES-256-GCM, stored as iv(12) | tag(16) | ciphertext.
// Key: FIELD_ENCRYPTION_KEY (any string, hashed to 32 bytes); outside production it falls back to JWT_SECRET.
// shortcut: one static key, no rotation; add a key id byte and a rotation job before production.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.FIELD_ENCRYPTION_KEY || (process.env.NODE_ENV !== "production" ? process.env.JWT_SECRET : "");
  if (!secret) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(secret).digest();
}

export function encryptText(plain: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body]));
}

export function decryptText(stored: Uint8Array): string {
  const b = Buffer.from(stored);
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export const encryptJson = (value: unknown) => encryptText(JSON.stringify(value));
export const decryptJson = <T = unknown>(stored: Uint8Array) => JSON.parse(decryptText(stored)) as T;
