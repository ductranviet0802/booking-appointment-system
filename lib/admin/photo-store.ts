// spec-screen: A03
// Doctor photos (A03 item 10, events 9 / 10, 更新6): checked by content, cropped square, always 400 x 400, kept as JPEG / PNG.
// shortcut: local disk, one instance; move to object storage before a multi-instance deploy
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FILE_NAME } from "@/lib/admin/masters-rules";

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIZE = 400;
export const PHOTO_URL_PREFIX = "/api/photos/";
const TYPES = { jpg: "image/jpeg", png: "image/png" } as const;

const dir = () => path.resolve(process.env.PHOTO_DIR || "var/photos");

/** "/api/photos/<file>" → <file> when it is a well-formed stored name */
export function fileOfUrl(url: unknown) {
  if (typeof url !== "string" || !url.startsWith(PHOTO_URL_PREFIX)) return null;
  const file = url.slice(PHOTO_URL_PREFIX.length);
  return FILE_NAME.test(file) ? file : null;
}

export const contentTypeOf = (file: string) => TYPES[file.endsWith(".png") ? "png" : "jpg"];

export async function photoExists(file: string) {
  return stat(path.join(dir(), file)).then((s) => s.isFile(), () => false);
}

export const readPhoto = (file: string) => readFile(path.join(dir(), file));

/** the stored address (for doctors.photo_url), or null when the content is not a JPEG / PNG or is over 2 MB (SE053) */
export async function storePhoto(bytes: Buffer): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  let format: string | undefined;
  try {
    format = (await sharp(bytes).metadata()).format;
  } catch {
    return null;
  }
  if (format !== "jpeg" && format !== "png") return null;
  const ext = format === "png" ? "png" : "jpg";
  const base = sharp(bytes).rotate().resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "centre" });
  const out = await (format === "png" ? base.png() : base.jpeg({ quality: 88 })).toBuffer();
  const file = `${randomUUID()}.${ext}`;
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), file), out);
  return `${PHOTO_URL_PREFIX}${file}`;
}
