import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BILLING_REPORT_PATH = "billing/cost-report.json";

interface BillingServiceEntry {
  name: string;
  cost: number;
  credits?: number;
}

interface BillingMonthEntry {
  month: string;
  total: number;
  totalCredits?: number;
  byService: BillingServiceEntry[];
}

interface BillingCostReport {
  generatedAt: string;
  currency: string;
  months: BillingMonthEntry[];
}

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      storage = new Storage({ credentials });
    } else {
      storage = new Storage();
    }
  }

  return storage;
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeReport(raw: unknown): BillingCostReport {
  if (!isRecord(raw)) {
    throw new TypeError("Invalid report payload");
  }

  const obj = raw;

  if (typeof obj.generatedAt !== "string" || typeof obj.currency !== "string") {
    throw new TypeError("Invalid report metadata");
  }

  if (!Array.isArray(obj.months)) {
    throw new TypeError("Invalid months data");
  }

  const months: BillingMonthEntry[] = obj.months.map((monthEntry) => {
    if (!isRecord(monthEntry)) {
      throw new TypeError("Invalid month entry");
    }

    const monthObj = monthEntry;
    const total = toNumber(monthObj.total);

    if (
      typeof monthObj.month !== "string" ||
      total === null ||
      !Array.isArray(monthObj.byService)
    ) {
      throw new TypeError("Invalid month fields");
    }

    const totalCreditsNumber =
      monthObj.totalCredits === undefined
        ? undefined
        : toNumber(monthObj.totalCredits);

    const byService: BillingServiceEntry[] = monthObj.byService.map(
      (serviceEntry) => {
        if (!isRecord(serviceEntry)) {
          throw new TypeError("Invalid service entry");
        }

        const serviceObj = serviceEntry;
        const cost = toNumber(serviceObj.cost);
        if (typeof serviceObj.name !== "string" || cost === null) {
          throw new TypeError("Invalid service fields");
        }

        const creditsNumber =
          serviceObj.credits === undefined
            ? undefined
            : toNumber(serviceObj.credits);

        return {
          name: serviceObj.name,
          cost,
          ...(creditsNumber !== null && creditsNumber !== undefined
            ? { credits: creditsNumber }
            : {}),
        };
      },
    );

    return {
      month: monthObj.month,
      total,
      ...(totalCreditsNumber !== null && totalCreditsNumber !== undefined
        ? { totalCredits: totalCreditsNumber }
        : {}),
      byService,
    };
  });

  return {
    generatedAt: obj.generatedAt,
    currency: obj.currency,
    months,
  };
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
    const file = gcs.bucket(bucket).file(BILLING_REPORT_PATH);
    const [exists] = await file.exists();

    if (!exists) {
      return NextResponse.json(
        { error: "Billing report not generated yet" },
        { status: 404 },
      );
    }

    const [content] = await file.download();
    const report = normalizeReport(JSON.parse(content.toString("utf-8")));

    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("Failed to load billing report", err);
    return NextResponse.json(
      { error: "Failed to load report" },
      { status: 500 },
    );
  }
}
