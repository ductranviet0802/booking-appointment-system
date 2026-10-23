// spec-screen: A03
// Event 5 (保存する): body { kind: "doctor" | "department" | "visitType", id?, …the form }
import type { NextRequest } from "next/server";
import { adminRoute, bad } from "@/lib/admin/common";
import { saveDepartment, saveDoctor, saveVisitType } from "@/lib/admin/masters";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => {
    switch (body.kind) {
      case "doctor": return saveDoctor(actor, body);
      case "department": return saveDepartment(actor, body);
      case "visitType": return saveVisitType(actor, body);
      default: return Promise.resolve(bad());
    }
  });
}
