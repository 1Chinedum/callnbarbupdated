import { errorResponse } from "@/lib/http";
import { POST_LOGOUT } from "@/lib/auth-handlers";

export async function POST() {
  try {
    return await POST_LOGOUT();
  } catch (e) {
    return errorResponse(e);
  }
}
