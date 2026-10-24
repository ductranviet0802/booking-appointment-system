// Export file store (03 §3.28, 06 B6 "store encrypted"): X5 CSV and S03 disclosure ZIP files, AES-256-GCM at rest
// (lib/crypto/field.ts key) under EXPORT_DIR (default var/export). sha256 is of the plain file the user downloads.
// shortcut: a local folder on one instance; move to encrypted object storage before scale-out.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBytes, encryptBytes } from "@/lib/crypto/field";

const dir = () => process.env.EXPORT_DIR ?? "var/export";
const SAFE = /^[A-Za-z0-9_.-]+$/;

/** writes `bytes` encrypted; returns the export_files values (storage_key = file name inside EXPORT_DIR) */
export async function storeExportFile(fileName: string, bytes: Uint8Array) {
  if (!SAFE.test(fileName)) throw new Error(`bad export file name: ${fileName}`);
  await mkdir(dir(), { recursive: true });
  const storageKey = `${Date.now()}_${fileName}`; // unique even when two runs share a minute (file names are per minute)
  await writeFile(path.join(dir(), storageKey), encryptBytes(bytes));
  return { storageKey, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** the plain bytes of a stored file */
export async function readExportFile(storageKey: string): Promise<Buffer> {
  if (!SAFE.test(storageKey)) throw new Error(`bad storage key: ${storageKey}`);
  return decryptBytes(await readFile(path.join(dir(), storageKey)));
}

export async function exportFileExists(storageKey: string) {
  if (!SAFE.test(storageKey)) return false;
  return stat(path.join(dir(), storageKey)).then(() => true, () => false);
}

/** B5: the file goes, the export_files row stays (06 §5) */
export async function deleteExportFile(storageKey: string) {
  if (!SAFE.test(storageKey)) throw new Error(`bad storage key: ${storageKey}`);
  await rm(path.join(dir(), storageKey), { force: true });
}
