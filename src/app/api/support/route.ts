import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";
import { ticketSchema } from "@/lib/validators";

export async function GET() {
  try {
    const session = await requireSession();
    const tickets = await prisma.supportTicket.findMany({
      where: session.role === "ADMIN" ? {} : { userId: session.id },
      include: { messages: true, user: true },
      orderBy: { createdAt: "desc" },
    });
    return json({ tickets });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = ticketSchema.parse(await request.json());
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: session.id,
        bookingId: body.bookingId,
        category: body.category,
        subject: body.subject,
        description: body.description,
      },
    });
    return json({ ticket }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
