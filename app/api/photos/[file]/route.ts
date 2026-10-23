// spec-screen: A03
// Serves the stored doctor photos (public GET: P08 / P09 show them to patients). Files never change once stored (new name per upload).
import { FILE_NAME } from "@/lib/admin/masters-rules";
import { contentTypeOf, photoExists, readPhoto } from "@/lib/admin/photo-store";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!FILE_NAME.test(file) || !(await photoExists(file))) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(await readPhoto(file)), {
    headers: { "Content-Type": contentTypeOf(file), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
