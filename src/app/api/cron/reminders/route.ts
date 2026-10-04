import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { appConfig } from "@/lib/env";
import { errorResponse, json } from "@/lib/http";
import { notify } from "@/lib/notify";
import { bookingDateTime } from "@/lib/time";

export async function GET(request: NextRequest) {
  try {
    const secret = request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-cron-secret");
    if (!appConfig.cronSecret || secret !== appConfig.cronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }
    const now = Date.now();
    const upcoming = await prisma.booking.findMany({
      where: {
        status: { in: ["ACCEPTED", "BARBER_PENDING", "ON_THE_WAY"] },
      },
      include: { customer: true, barber: { include: { user: true } }, service: true },
    });
    let sent = 0;
    for (const b of upcoming) {
      const start = bookingDateTime(b.bookingDate, b.startTime).getTime();
      const hours = (start - now) / 36e5;
      if (hours <= 24 && hours > 23 && !b.reminder24SentAt) {
        await notify({
          userId: b.customerId,
          title: "Appointment reminder",
          message: `${b.service.name} with ${b.barber.user.name} is tomorrow at ${b.startTime}.`,
          type: "reminder_24h",
        });
        await prisma.booking.update({
          where: { id: b.id },
          data: { reminder24SentAt: new Date() },
        });
        sent++;
      }
      if (hours <= 1 && hours > 0 && !b.reminder1SentAt) {
        await notify({
          userId: b.customerId,
          title: "Appointment in 1 hour",
          message: `Your barber is scheduled at ${b.startTime}. Have your QR ready.`,
          type: "reminder_1h",
        });
        await notify({
          userId: b.barber.userId,
          title: "Appointment in 1 hour",
          message: `You have ${b.service.name} at ${b.startTime}.`,
          type: "reminder_1h",
        });
        await prisma.booking.update({
          where: { id: b.id },
          data: { reminder1SentAt: new Date() },
        });
        sent++;
      }
    }
    return json({ sent });
  } catch (e) {
    return errorResponse(e);
  }
}
