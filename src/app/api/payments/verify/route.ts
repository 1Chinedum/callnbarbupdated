import { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/http";
import { verifyAndConfirm } from "@/lib/paystack";
import { requireRole } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await requireRole("CUSTOMER", "ADMIN");
    const { reference } = await request.json();
    const payment = await verifyAndConfirm(String(reference));
    return json({ payment });
  } catch (e) {
    return errorResponse(e);
  }
}
