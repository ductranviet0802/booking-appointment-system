// Q-009 answer: NT-05 / NT-06 always use the 04 §6 default text; A04 edits (any clinic's row) never apply.
import { pool, prisma } from "@/lib/prisma";
import { renderNotification } from "@/lib/notify/render";
import { MAIL_DEFAULTS } from "@/lib/notify/templates-default";

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

it("NT05 / NT06 ignore an edited clinic template; NT01 still uses it", async () => {
  const clinic = await prisma.clinic.findFirstOrThrow({ where: { isActive: true }, orderBy: { displayOrder: "asc" } });
  const admin = await prisma.account.findFirstOrThrow({ where: { email: "admin.all@example.jp" } });
  const vars = { reset_url: "https://x/r", valid_minutes: "30", verify_url: "https://x/v", valid_hours: "24" };
  const keys = (event: "NT05_PW_RESET" | "NT06_VERIFY") => ({ clinicId_event_channel_language: { clinicId: clinic.id, event, channel: "MAIL" as const, language: "JA" as const } });
  const saved = await prisma.notificationTemplate.findMany({ where: { clinicId: clinic.id, event: { in: ["NT05_PW_RESET", "NT06_VERIFY"] }, channel: "MAIL", language: "JA" } });
  try {
    for (const event of ["NT05_PW_RESET", "NT06_VERIFY"] as const) {
      await prisma.notificationTemplate.upsert({
        where: keys(event),
        update: { subject: "EDITED", body: "EDITED {{reset_url}}" },
        create: { clinicId: clinic.id, event, channel: "MAIL", language: "JA", subject: "EDITED", body: "EDITED {{reset_url}}", updatedBy: admin.id },
      });
      const out = await renderNotification({ event, channel: "MAIL", language: "JA", bookingId: null }, vars);
      expect(out.body).not.toContain("EDITED");
      expect(out.subject).toBe(MAIL_DEFAULTS[event].subject.JA.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars as Record<string, string>)[k] ?? ""));
    }
  } finally {
    for (const event of ["NT05_PW_RESET", "NT06_VERIFY"] as const) {
      const old = saved.find((r) => r.event === event);
      if (old) await prisma.notificationTemplate.update({ where: { id: old.id }, data: { subject: old.subject, body: old.body } });
      else await prisma.notificationTemplate.delete({ where: keys(event) });
    }
  }
});
