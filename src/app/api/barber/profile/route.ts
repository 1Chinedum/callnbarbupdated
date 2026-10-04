import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { barberServiceSchema, availabilitySchema } from "@/lib/validators";
import { requireBarberProfile } from "@/lib/qr";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireRole("BARBER");
    const profile = await prisma.barberProfile.findUnique({
      where: { userId: session.id },
      include: {
        services: { include: { category: true } },
        availability: true,
        wallet: true,
        user: true,
      },
    });
    return json({ profile });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const body = await request.json();
    await prisma.user.update({
      where: { id: session.id },
      data: { name: body.name ?? undefined, phone: body.phone ?? undefined },
    });
    const updated = await prisma.barberProfile.update({
      where: { id: profile.id },
      data: {
        bio: body.bio,
        experienceYears: body.experienceYears,
        serviceArea: body.serviceArea,
        addressLine: body.addressLine,
        city: body.city,
        state: body.state,
        bankName: body.bankName,
        accountNumber: body.accountNumber,
        accountName: body.accountName,
        homeService: body.homeService,
      },
    });
    return json({ profile: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireRole("BARBER", "CUSTOMER");
    const body = await request.json();
    if (body.password && body.currentPassword) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id } });
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw new AppError("Current password is incorrect.");
      }
      await prisma.user.update({
        where: { id: session.id },
        data: { passwordHash: await hashPassword(body.password) },
      });
    }
    if (body.name || body.phone) {
      await prisma.user.update({
        where: { id: session.id },
        data: { name: body.name, phone: body.phone },
      });
    }
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export { barberServiceSchema, availabilitySchema };
