import { NextRequest } from "next/server";
import { errorResponse } from "@/lib/http";
import { POST_LOGIN } from "@/lib/auth-handlers";

export async function POST(request: NextRequest) {
  try {
    return await POST_LOGIN(request);
  } catch (e) {
    return errorResponse(e);
  }
}
