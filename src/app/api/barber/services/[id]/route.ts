import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { barberServiceSchema } from "@/lib/validators";
import { requireBarberProfile } from "@/lib/qr";
import { ForbiddenError } from "@/lib/errors";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const { id } = await ctx.params;
    const existing = await prisma.barberService.findUnique({ where: { id } });
    if (!existing || existing.barberId !== profile.id) throw new ForbiddenError();
    const body = barberServiceSchema.partial().parse(await request.json());
    const service = await prisma.barberService.update({ where: { id }, data: body });
    return json({ service });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const { id } = await ctx.params;
    const existing = await prisma.barberService.findUnique({ where: { id } });
    if (!existing || existing.barberId !== profile.id) throw new ForbiddenError();
    await prisma.barberService.update({ where: { id }, data: { active: false } });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
