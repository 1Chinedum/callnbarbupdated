import { prisma } from "./prisma";
import { NotificationChannel } from "@prisma/client";

type NotifyInput = {
  userId: string;
  title: string;
  message: string;
  type: string;
  data?: Record<string, unknown>;
};

export async function notify(input: NotifyInput) {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId: input.userId },
  });
  if (prefs && !prefs.inApp) return null;

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      message: input.message,
      type: input.type,
      channel: NotificationChannel.IN_APP,
      dataJson: input.data ? JSON.stringify(input.data) : null,
    },
  });

  // Provider hooks (email / SMS / push) are architected here for later integration.
  return notification;
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}
