import { NextResponse } from "next/server";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { loadInterestReport } from "@/lib/interest-coverage-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unavailableHeaders = { "Cache-Control": "no-store" };
const reportHeaders = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

/** Public GCS snapshot endpoint. Privacy suppression is applied by the generator. */
export async function GET() {
  if (!hasReportPagesEnabled()) {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: unavailableHeaders });
  }
  try {
    const report = await loadInterestReport();
    if (!report) return NextResponse.json({ status: "unavailable" }, { status: 503, headers: unavailableHeaders });
    return NextResponse.json(report, { headers: reportHeaders });
  } catch (error) {
    console.error("Failed to load interest coverage report", error);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: unavailableHeaders });
  }
}
