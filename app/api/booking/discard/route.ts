// spec-screen: P11
// T057 (P11 event 12, P12 event 14, P13 event 9): the draft is discarded; the answer names the origin screen of the
// draft (change mode P16, fallback P01). P13 Q2 A: a header link pressed on P13 goes to that link instead (the client).
import type { NextRequest } from "next/server";
import { dropDraft, getDraft } from "@/lib/booking/draft";
import { originOr } from "@/lib/entry/pages";
import { entryRoute, go, withDraftCookie } from "@/lib/entry/route";

export function POST(req: NextRequest) {
  return entryRoute(req, { login: false }, async (v, body) => {
    const d = getDraft(v.draftId, v.owner);
    dropDraft(v.draftId);
    return withDraftCookie(go(d?.origin ?? originOr(body.origin)), null);
  });
}
