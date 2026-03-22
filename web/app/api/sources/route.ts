import { NextResponse } from "next/server";
import sources from "@/lib/sources";

export async function GET() {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://oboapp.online";

  const response = sources.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    logoUrl: `${baseUrl}/sources/${source.id}.png`,
  }));

  return NextResponse.json({ sources: response });
}
