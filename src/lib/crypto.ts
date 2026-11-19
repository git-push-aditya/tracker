import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./http";

// AES-256-GCM for secrets we must store (Notion tokens). Format: "iv.tag.ciphertext", each base64url.
// The key is 32 random bytes, base64, in NOTION_TOKEN_KEY. Rotating it means every user reconnects Notion.
function key(raw = process.env.NOTION_TOKEN_KEY) {
  const k = raw ? Buffer.from(raw, "base64") : undefined;
  if (k?.length !== 32) throw new HttpError(503, "Notion isn't configured");
  return k;
}

export function seal(text: string, rawKey?: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

// Throws on a tampered value or the wrong key (GCM checks the tag).
export function unseal(sealed: string, rawKey?: string) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(rawKey), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
