// spec-screen: A03
// Event 9 (写真の選択): the raw file is the request body; the answer is the stored address for the form (saved by event 5).
import type { NextRequest } from "next/server";
import { adminRoute, done, fail } from "@/lib/admin/common";
import { storePhoto } from "@/lib/admin/photo-store";

export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const url = await storePhoto(Buffer.from(await req.arrayBuffer()));
    return url ? done({ photoUrl: url }) : fail(400, "SE053", undefined, [{ field: "photo", code: "SE053" }]);
  }, { raw: true });
}
