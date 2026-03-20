import { NextResponse } from "next/server";
import sources from "@/lib/sources.json";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  const typedSources: Array<{ id: string; name: string; url: string }> =
    sources;
  const response = typedSources.map((source) => ({
    ...source,
    logoUrl: `${baseUrl}/sources/${source.id}.png`,
  }));

  return NextResponse.json({ sources: response });
}
