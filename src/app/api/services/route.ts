import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/http";

export async function GET() {
  try {
    const services = await prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
    return json({ services });
  } catch (e) {
    return errorResponse(e);
  }
}
