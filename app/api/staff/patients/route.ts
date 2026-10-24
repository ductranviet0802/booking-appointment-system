// spec-screen: S03
// The S03 requests (RECEPTION, ADMIN; disclosure ADMIN only): body { action, … }.
// save = event 6 · confirm = event 7 · questionnaire = event 8 · mergeSearch = event 17 · mergeCheck / merge = event 9 · disclosure = event 12
import type { NextRequest } from "next/server";
import { adminRoute, bad } from "@/lib/admin/common";
import { confirmCard, loadDetail, merge, mergeCheck, mergeSearch, openQuestionnaire, requestDisclosure, saveProfile } from "@/lib/staff/patients";

const ACTIONS = { save: saveProfile, confirm: confirmCard, questionnaire: openQuestionnaire, mergeSearch, mergeCheck, merge, disclosure: requestDisclosure };
/** B-9: a change answers the detail as it is now, so the screen is redrawn without a page refresh — a refresh would write a
 *  second PATIENT_VIEW, and S03 更新9 is written when a detail is opened (events 2, 15, 16), not after 保存 / 確認 / 統合 */
const REDRAW = new Set(["save", "confirm", "merge"]);

export function POST(req: NextRequest) {
  return adminRoute(
    req,
    async (actor, body) => {
      if (typeof body.action !== "string" || !Object.hasOwn(ACTIONS, body.action)) return bad();
      const r = await ACTIONS[body.action as keyof typeof ACTIONS](actor, body);
      if (r.ok && REDRAW.has(body.action)) r.body.detail = await loadDetail(String(body.id), { accountId: actor.accountId });
      return r;
    },
    { roles: ["RECEPTION", "ADMIN"] },
  );
}
