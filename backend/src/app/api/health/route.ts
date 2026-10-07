import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeLlm } from "@/lib/llm-config";

export const runtime = "nodejs";

export async function GET() {
  const llm = describeLlm();
  const result = {
    api: "ok",
    database: "unavailable",
    llm: llm.configured ? "ok" : "not configured",
    provider: llm.provider,
    model: llm.model,
    error: llm.error,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.database = "ok";
  } catch {
    // Report each dependency independently.
  }

  const healthy = result.database === "ok" && llm.configured;
  return NextResponse.json(result, { status: healthy ? 200 : 503 });
}
