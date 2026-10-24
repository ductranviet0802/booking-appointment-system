// Minimal ZIP writer for the S03 disclosure file (no dependency): deflate (zlib.deflateRawSync), CRC-32 (zlib.crc32),
// local headers + central directory + end record, names flagged UTF-8 (bit 11).
// shortcut: no ZIP64 — at most 65535 entries and 4 GiB per entry/archive; zipFiles throws beyond that (the disclosure cap is far below).
import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Uint8Array };

const MAX32 = 0xffff_ffff;
const UTF8 = 0x0800;

/** DOS date / time of a Date, local fields read as UTC so that the output does not depend on the server's zone */
function dosStamp(d: Date) {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function zipFiles(entries: ZipEntry[], at = new Date()): Buffer {
  if (entries.length > 0xffff) throw new Error("zip: too many entries");
  const { time, date } = dosStamp(at);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.data);
    const deflated = deflateRawSync(raw);
    const method = deflated.length < raw.length ? 8 : 0; // stored when deflate does not help
    const body = method === 8 ? deflated : raw;
    if (raw.length > MAX32 || offset > MAX32) throw new Error("zip: over 4 GiB");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // made by
    cd.writeUInt16LE(20, 6); // needed
    cd.writeUInt16LE(UTF8, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBytes = Buffer.concat(central);
  if (offset + cdBytes.length > MAX32) throw new Error("zip: over 4 GiB");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBytes, end]);
}
