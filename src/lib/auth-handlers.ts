import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie, verifyPassword, clearSessionCookie, requireSession } from "@/lib/auth";
import { registerSchema, loginSchema, forgotSchema, resetSchema } from "@/lib/validators";
import { json, errorResponse } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { hashToken, randomToken } from "@/lib/crypto";
import { notify } from "@/lib/notify";

function referral() {
  return `CNB${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function POST_REGISTER(request: NextRequest) {
  if (!rateLimit(clientKey(request, "register"), 8, 60_000)) {
    throw new AppError("Too many attempts. Try again shortly.", 429);
  }
  const body = registerSchema.parse(await request.json());
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: body.email.toLowerCase() }, { phone: body.phone }] },
  });
  if (existing) throw new AppError("An account with that email or phone already exists.");

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        role: body.role as Role,
        name: body.name,
        email: body.email.toLowerCase(),
        phone: body.phone,
        passwordHash: await hashPassword(body.password),
        referredByCode: body.referralCode,
        referralCode: referral(),
      },
    });
    await tx.notificationPreference.create({ data: { userId: created.id } });
    if (body.role === "BARBER") {
      const profile = await tx.barberProfile.create({
        data: { userId: created.id, verificationStatus: "PENDING" },
      });
      await tx.wallet.create({ data: { barberId: profile.id } });
    }
    return created;
  });

  await setSessionCookie({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
  });

  return json({
    user: { id: user.id, role: user.role, name: user.name, email: user.email },
  });
}

export async function POST_LOGIN(request: NextRequest) {
  if (!rateLimit(clientKey(request, "login"), 10, 60_000)) {
    throw new AppError("Too many attempts. Try again shortly.", 429);
  }
  const body = loginSchema.parse(await request.json());
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new AppError("Invalid email or password.", 401);
  }
  if (user.status !== "ACTIVE") {
    throw new AppError("This account is not active.", 403);
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await setSessionCookie({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
  });
  return json({
    user: { id: user.id, role: user.role, name: user.name, email: user.email },
  });
}

export async function POST_LOGOUT() {
  await clearSessionCookie();
  return json({ ok: true });
}

export async function GET_ME() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: { barberProfile: true, notificationPrefs: true },
  });
  return json({
    user: {
      id: user!.id,
      role: user!.role,
      name: user!.name,
      email: user!.email,
      phone: user!.phone,
      profileImage: user!.profileImage,
      status: user!.status,
      barberProfile: user!.barberProfile
        ? {
            id: user!.barberProfile.id,
            verificationStatus: user!.barberProfile.verificationStatus,
            bio: user!.barberProfile.bio,
            experienceYears: user!.barberProfile.experienceYears,
          }
        : null,
    },
  });
}

export async function POST_FORGOT(request: NextRequest) {
  if (!rateLimit(clientKey(request, "forgot"), 5, 60_000)) {
    throw new AppError("Too many attempts. Try again shortly.", 429);
  }
  const { email } = forgotSchema.parse(await request.json());
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user) {
    const token = randomToken(24);
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      },
    });
    await notify({
      userId: user.id,
      title: "Password reset",
      message: `Use this reset token in development: ${token}`,
      type: "password_reset",
    });
  }
  return json({ ok: true, message: "If that email exists, a reset link was created." });
}

export async function POST_RESET(request: NextRequest) {
  const body = resetSchema.parse(await request.json());
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(body.token) },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("Reset link is invalid or expired.");
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(body.password) },
    }),
    prisma.passwordReset.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return json({ ok: true });
}

export { errorResponse };
