import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { ZodError } from "zod";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "Invalid input.";
    return NextResponse.json({ error: message, code: "VALIDATION" }, { status: 422 });
  }
  console.error(error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again.", code: "INTERNAL" },
    { status: 500 },
  );
}
