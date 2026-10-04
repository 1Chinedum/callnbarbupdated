import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export async function GET() {
  try {
    const session = await requireSession();
    const notifications = await prisma.notification.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unread = notifications.filter((n) => !n.readAt).length;
    return json({ notifications, unread });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST() {
  try {
    const session = await requireSession();
    await prisma.notification.updateMany({
      where: { userId: session.id, readAt: null },
      data: { readAt: new Date() },
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
