// Vercel Cron entry point — see vercel.json for the schedule. Runs the same
// sync logic as `npm run odds:sync` (scripts/sync-odds.mjs), shared via
// src/lib/sync-odds-core.ts. Gated on CRON_SECRET so this endpoint can't be
// triggered by an arbitrary request and burn through the Odds API's
// request quota — Vercel automatically sends this header on scheduled
// invocations once CRON_SECRET is set as a project environment variable.
import { NextRequest, NextResponse } from "next/server";
import { runOddsSync } from "@/lib/sync-odds-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runOddsSync({ skipRateLimit: false });
    return NextResponse.json(report);
  } catch (err) {
    console.error("Odds sync failed:", err);
    // Supabase throws plain PostgrestError-shaped objects, not native Error
    // instances, so `err instanceof Error` alone would swallow the real
    // message here.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    return NextResponse.json({ error: message, raw: err }, { status: 500 });
  }
}
