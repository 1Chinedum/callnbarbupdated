import { errorResponse } from "@/lib/http";
import { GET_ME } from "@/lib/auth-handlers";

export async function GET() {
  try {
    return await GET_ME();
  } catch (e) {
    return errorResponse(e);
  }
}
