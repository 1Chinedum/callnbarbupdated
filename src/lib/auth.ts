import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { Role, UserStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { appConfig } from "./env";
import { ForbiddenError, UnauthorizedError } from "./errors";

const COOKIE = "callnbarb_session";
const encoder = new TextEncoder();

export type SessionUser = {
  id: string;
  role: Role;
  name: string;
  email: string;
  status: UserStatus;
};

function secret() {
  return encoder.encode(appConfig.jwtSecret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signSession(user: SessionUser) {
  return new SignJWT({
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${appConfig.sessionDays}d`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.role) return null;
    return {
      id: payload.sub,
      role: payload.role as Role,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      status: (payload.status as UserStatus) ?? "ACTIVE",
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser) {
  const token = await signSession(user);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.isProd,
    path: "/",
    maxAge: appConfig.sessionDays * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await readSessionToken(token);
  if (!session) return null;
  if (session.status === "SUSPENDED") return null;
  return session;
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("This account is not active.");
  }
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
  };
}

export async function requireRole(...roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.role)) {
    throw new ForbiddenError();
  }
  return session;
}

export { COOKIE as SESSION_COOKIE };
