import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { barberServiceSchema } from "@/lib/validators";
import { requireBarberProfile } from "@/lib/qr";

export async function GET() {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const services = await prisma.barberService.findMany({
      where: { barberId: profile.id },
      include: { category: true },
    });
    return json({ services });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("BARBER");
    const profile = await requireBarberProfile(session.id);
    const body = barberServiceSchema.parse(await request.json());
    const service = await prisma.barberService.create({
      data: { ...body, barberId: profile.id },
    });
    return json({ service }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
