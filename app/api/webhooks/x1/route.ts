// X1 inbound webhook (05 X1): bounce events, signature verified. Body: { "providerMessageId": "…", "type": "hard" | "soft" }.
// Signature: header x-signature = hex HMAC-SHA256 of the raw body with X1_WEBHOOK_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordMailBounce } from "@/lib/notify/queue";

const bodySchema = z.object({ providerMessageId: z.string().min(1).max(100), type: z.enum(["hard", "soft"]) });

export async function POST(request: NextRequest) {
  const secret = process.env.X1_WEBHOOK_SECRET;
  const raw = await request.text();
  const given = Buffer.from(request.headers.get("x-signature") ?? "", "hex");
  const expected = secret ? createHmac("sha256", secret).update(raw).digest() : null;
  if (!expected || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ code: "BAD_SIGNATURE" }, { status: 401 });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // stays null → 400
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  await recordMailBounce(parsed.data.providerMessageId, parsed.data.type === "hard");
  return NextResponse.json({ ok: true });
}
