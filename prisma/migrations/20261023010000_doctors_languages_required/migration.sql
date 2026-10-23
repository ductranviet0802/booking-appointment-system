-- 03 §3.7 doctors.languages: Null no, default {ja}. Prisma cannot mark a scalar list NOT NULL (a SET NOT NULL would
-- show as drift on the next migrate dev), so the rule is a CHECK, which Prisma leaves alone.
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_languages_required" CHECK ("languages" IS NOT NULL);
