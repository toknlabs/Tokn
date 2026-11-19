import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { cliSync } from "@/lib/backend";
import { boardUpdatedAt, leaderboard, nextBoardUpdate } from "@/lib/stats";

/**
 * POST /api/cli/sync — store one scan.
 *
 * The CLI re-uploads its whole history every run, so rows are upserted on
 * (user, day, tool, model, fast) and **replace** rather than accumulate. That
 * is what lets a corrected scan heal whatever the last one got wrong; without
 * it a second sync would double every number on the leaderboard.
 *
 * All of the logic lives in the backend service so this route and the
 * standalone server cannot drift apart.
 *
 * The upload is on the person's own profile as soon as this returns. The
 * leaderboard takes it in at the top of the next hour, so the reply says when,
 * and the rank it reports is the board's rather than a live figure the board
 * does not show yet.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const result = await cliSync(request.headers.get("authorization"), body as never, {
    rankOf: boardRank,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // The pricing route is cached for an hour. A table that just learned a new
  // model has to reach the next CLI that asks, not the one after the hour.
  if (result.newlyPriced) {
    revalidatePath("/api/cli/pricing");
    revalidateTag("model-logos");
  }

  return NextResponse.json({
    ...result,
    board: { updatedAt: await boardUpdatedAt(), nextUpdateAt: nextBoardUpdate() },
  });
}

/**
 * Where someone stands on the board as it is shown. Null until the board has
 * any spend of theirs: every account is listed from sign-up, and being last
 * among the people who have reported nothing is not a rank worth printing.
 */
async function boardRank(userId: string): Promise<number | null> {
  const board = await leaderboard("all", "cost", 100_000);
  const entry = board.find((row) => row.userId === userId);
  return entry && entry.cost > 0 ? entry.rank : null;
}
