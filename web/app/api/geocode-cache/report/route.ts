import { NextResponse } from "next/server";

export const runtime = "nodejs";

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = new Storage();
  }
  return storage;
}

export async function GET() {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) {
    return NextResponse.json(
      { error: "GCS_GENERIC_BUCKET not configured" },
      { status: 503 },
    );
  }

  try {
    const gcs = await getStorage();
    const file = gcs.bucket(bucket).file("geocode-cache/frequency-report.json");
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json(
        { error: "Frequency report not generated yet" },
        { status: 404 },
      );
    }
    const [content] = await file.download();
    const report = JSON.parse(content.toString("utf-8"));
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("Failed to load geocode frequency report", err);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
