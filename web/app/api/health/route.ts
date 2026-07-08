import { NextResponse } from "next/server";

const HEALTH_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=120";

export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    {
      headers: {
        "Cache-Control": HEALTH_CACHE_CONTROL,
      },
    },
  );
}
