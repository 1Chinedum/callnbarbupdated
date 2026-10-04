import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { getAvailableSlots } from "@/lib/slots";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("CUSTOMER", "BARBER", "ADMIN");
    const { id } = await ctx.params;
    const url = new URL(_.url);
    const date = url.searchParams.get("date");
    if (!date) return json({ slots: [] });
    const slots = await getAvailableSlots(id, date);
    return json({ slots });
  } catch (e) {
    return errorResponse(e);
  }
}
