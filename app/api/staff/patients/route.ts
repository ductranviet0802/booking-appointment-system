// spec-screen: S03
// The S03 requests (RECEPTION, ADMIN; disclosure ADMIN only): body { action, … }.
// save = event 6 · confirm = event 7 · questionnaire = event 8 · mergeSearch = event 17 · mergeCheck / merge = event 9 · disclosure = event 12
import type { NextRequest } from "next/server";
import { adminRoute, bad } from "@/lib/admin/common";
import { confirmCard, merge, mergeCheck, mergeSearch, openQuestionnaire, requestDisclosure, saveProfile } from "@/lib/staff/patients";

const ACTIONS = { save: saveProfile, confirm: confirmCard, questionnaire: openQuestionnaire, mergeSearch, mergeCheck, merge, disclosure: requestDisclosure };

export function POST(req: NextRequest) {
  return adminRoute(
    req,
    (actor, body) =>
      typeof body.action === "string" && Object.hasOwn(ACTIONS, body.action)
        ? ACTIONS[body.action as keyof typeof ACTIONS](actor, body)
        : Promise.resolve(bad()),
    { roles: ["RECEPTION", "ADMIN"] },
  );
}
