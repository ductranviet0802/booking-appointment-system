// spec-screen: A06
// ダウンロード (event 4): ?id=<export_files.id>. Refusals: another clinic / DISCLOSURE for a receptionist → 403 SE091 (ER-03),
// unknown or expired → 404 SE090 (ER-02), not DONE → 409 SE090, a stored object that fails its sha256 → 500 SE090.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { downloadExport } from "@/lib/admin/export";

export function GET(req: NextRequest) {
  return adminRoute(
    req,
    async (a) => {
      const r = await downloadExport(a, req.nextUrl.searchParams.get("id"));
      if (!r.ok) return NextResponse.json({ code: r.code, params: {} }, { status: r.status });
      const isZip = r.fileName.endsWith(".zip");
      return new NextResponse(new Uint8Array(r.bytes), {
        headers: {
          "Content-Type": isZip ? "application/zip" : "text/csv; charset=Windows-31J",
          "Content-Disposition": `attachment; filename="${r.fileName}"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
          "Cache-Control": "no-store",
        },
      });
    },
    { roles: ["RECEPTION", "ADMIN"] },
  );
}
