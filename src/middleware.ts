import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = [
  "/",
  "/explore",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/about",
  "/contact",
  "/legal",
  "/barbers",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("callnbarb_session")?.value;
  const isPublic =
    PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/payments/webhook") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml";

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/payments/webhook")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/barbers") && request.method === "GET") {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/services") && request.method === "GET") {
      return NextResponse.next();
    }
    if (!token && !pathname.startsWith("/api/payments/dev-complete")) {
      if (pathname.startsWith("/api/cron")) return NextResponse.next();
      return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!isPublic && !token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads).*)"],
};
