// Vercel Cron entry point — see vercel.json for the schedule. Runs the same
// logic as `npm run rankings:sync` (scripts/sync-rankings.mjs), shared via
// src/lib/sync-rankings-core.ts. Gated on CRON_SECRET, same as the odds-sync
// route — see that file for why.
import { NextRequest, NextResponse } from "next/server";
import { runRankingsSync } from "@/lib/sync-rankings-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runRankingsSync();
    return NextResponse.json(report);
  } catch (err) {
    console.error("Rankings sync failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
