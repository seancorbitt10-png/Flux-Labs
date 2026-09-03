import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "flux-labs",
      phase: 1,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Service unavailable" },
      { status: 503 },
    );
  }
}
