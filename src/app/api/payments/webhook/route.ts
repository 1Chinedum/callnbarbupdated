import { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/http";
import { handleWebhook, verifyWebhookSignature } from "@/lib/paystack";

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const sig = request.headers.get("x-paystack-signature");
    if (!verifyWebhookSignature(raw, sig)) {
      return json({ error: "Invalid signature" }, 401);
    }
    await handleWebhook(JSON.parse(raw));
    return json({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
