import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deleteExportFile, readExportFile, storeExportFile } from "@/lib/export/store";

describe("export file store", () => {
  beforeAll(async () => {
    process.env.EXPORT_DIR = await mkdtemp(path.join(os.tmpdir(), "export-"));
  });

  it("stores encrypted, reads back the plain bytes, sha256 of the plain file, delete removes it", async () => {
    const plain = Buffer.from("\"予約番号\"\r\n", "utf8");
    const { storageKey, sha256 } = await storeExportFile("B_honin_20261024_0530.csv", plain);
    const onDisk = await readFile(path.join(process.env.EXPORT_DIR!, storageKey));
    expect(onDisk.includes(plain)).toBe(false);
    expect(await readExportFile(storageKey)).toEqual(plain);
    expect(sha256).toBe(createHash("sha256").update(plain).digest("hex"));
    await deleteExportFile(storageKey);
    await expect(readExportFile(storageKey)).rejects.toThrow();
  });

  it("refuses a path in the name", async () => {
    await expect(storeExportFile("../x.csv", Buffer.from("x"))).rejects.toThrow(/bad export file name/);
    await expect(readExportFile("../../etc/passwd")).rejects.toThrow(/bad storage key/);
  });
});
