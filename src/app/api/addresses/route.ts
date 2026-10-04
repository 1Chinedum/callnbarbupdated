import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { addressSchema } from "@/lib/validators";

export async function GET() {
  try {
    const session = await requireRole("CUSTOMER");
    const addresses = await prisma.address.findMany({
      where: { userId: session.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return json({ addresses });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole("CUSTOMER");
    const body = addressSchema.parse(await request.json());
    if (body.isDefault) {
      await prisma.address.updateMany({
        where: { userId: session.id },
        data: { isDefault: false },
      });
    }
    const address = await prisma.address.create({
      data: { ...body, userId: session.id },
    });
    return json({ address }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
