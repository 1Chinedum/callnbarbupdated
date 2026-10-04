import { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/http";
import { POST_REGISTER } from "@/lib/auth-handlers";

export async function POST(request: NextRequest) {
  try {
    return await POST_REGISTER(request);
  } catch (e) {
    return errorResponse(e);
  }
}
