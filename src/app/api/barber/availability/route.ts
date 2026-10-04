import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { availabilitySchema } from "@/lib/validators";
import { requireBarberProfile } from "@/lib/qr";

export async function PUT(request: NextRequest) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const body = availabilitySchema.parse(await request.json());
    await prisma.$transaction(async (tx) => {
      await tx.barberProfile.update({
        where: { id: profile.id },
        data: {
          slotMinutes: body.slotMinutes ?? profile.slotMinutes,
          maxDailyAppointments: body.maxDailyAppointments ?? profile.maxDailyAppointments,
        },
      });
      for (const day of body.days) {
        await tx.availability.upsert({
          where: { barberId_dayOfWeek: { barberId: profile.id, dayOfWeek: day.dayOfWeek } },
          update: day,
          create: { ...day, barberId: profile.id },
        });
      }
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
