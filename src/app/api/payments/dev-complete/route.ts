import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "@/lib/env";
import { verifyAndConfirm } from "@/lib/paystack";

export async function GET(request: NextRequest) {
  if (!appConfig.allowDevPayments) {
    return NextResponse.json({ error: "Disabled" }, { status: 403 });
  }
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference) return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  const payment = await verifyAndConfirm(reference);
  const url = request.nextUrl.clone();
  url.pathname = `/app/bookings/${payment?.bookingId}/confirm`;
  url.search = `?reference=${reference}`;
  return NextResponse.redirect(url);
}
