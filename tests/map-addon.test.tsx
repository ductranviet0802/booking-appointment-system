// demo add-on: map, not in ver1 spec — pin rule, DB check, CSP and the page without coordinates.
import { renderToStaticMarkup } from "react-dom/server";
import { prisma, pool } from "@/lib/prisma";
import { pinOf } from "@/lib/public/clinics";
import { loadClinicPage } from "@/lib/public/p10";
import { ClinicDetail } from "@/components/public/ClinicDetail";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

it("a pin needs both coordinates", () => {
  expect(pinOf({ latitude: 35.68, longitude: 139.76 })).toEqual({ lat: 35.68, lng: 139.76 });
  expect(pinOf({ latitude: 35.68, longitude: null })).toBeNull();
  expect(pinOf({ latitude: null, longitude: null })).toBeNull();
});

it("DB: both or neither coordinate, in range", async () => {
  await expect(prisma.clinic.update({ where: { code: "ekimae" }, data: { longitude: null } })).rejects.toThrow();
  await expect(prisma.clinic.update({ where: { code: "ekimae" }, data: { latitude: 91 } })).rejects.toThrow();
});

it("no coordinates → no map, the map link stays; with them → one map region", async () => {
  const page = await loadClinicPage("honin", "ja");
  expect(renderToStaticMarkup(<ClinicDetail data={page!} lang="ja" />)).toContain('data-testid="clinic-map"');
  const html = renderToStaticMarkup(<ClinicDetail data={{ ...page!, clinic: { ...page!.clinic, pin: null } }} lang="ja" />);
  expect(html).not.toContain("clinic-map");
  expect(html).toContain("地図を見る");
});

it("CSP: img-src allows only the OSM tile host besides self; no other external host", () => {
  // next.config.ts is ESM (import.meta): read its CSP lines as text
  const config = readFileSync(join(__dirname, "..", "next.config.ts"), "utf8");
  const csp = config.slice(config.indexOf("const contentSecurityPolicy"), config.indexOf('].join("; ")'));
  expect(csp).toContain(`"img-src 'self' data: blob: https://tile.openstreetmap.org"`);
  expect(csp.match(/https?:\/\/[^\s;"]+/g)).toEqual(["https://tile.openstreetmap.org"]);
});
