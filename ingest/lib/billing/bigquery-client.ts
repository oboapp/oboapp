/**
 * BigQuery client for fetching monthly GCP billing costs.
 *
 * Reads from the standard GCP billing export dataset. Configured via:
 *   BILLING_BIGQUERY_PROJECT   — GCP project that owns the BigQuery dataset
 *   BILLING_BIGQUERY_DATASET   — BigQuery dataset name
 *   BILLING_BIGQUERY_TABLE     — BigQuery table name (e.g. gcp_billing_export_v1_...)
 *   BILLING_BIGQUERY_LOCATION  — Dataset location, default "US"
 *
 * Authentication uses Application Default Credentials. Run:
 *   gcloud auth application-default login
 * or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 */

import type { MonthlyBillingEntry } from "./cost-store";

/** Validates that a GCP resource identifier is safe to interpolate into SQL. */
function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[\w.-]+$/.test(value)) {
    throw new Error(
      `${label} contains invalid characters: "${value}". Must only use letters, digits, underscores, dots, or hyphens.`,
    );
  }
}

export interface BillingQueryParams {
  project: string;
  dataset: string;
  table: string;
  location: string;
  /** Number of past months to include (counting back from start of current month). */
  months: number;
  /** Whether to include the current (partial) calendar month. */
  includeCurrentMonth: boolean;
}

interface BillingRow {
  month: string;
  service_name: string;
  currency: string;
  usage_cost: number;
  /** Sum of credits for this service/month (negative number from BigQuery). */
  credits_amount: number;
}

export interface BillingQueryResult {
  currency: string;
  months: MonthlyBillingEntry[];
}

function extractRow(row: Record<string, unknown>): BillingRow {
  return {
    month: typeof row["month"] === "string" ? row["month"] : "",
    service_name:
      typeof row["service_name"] === "string" ? row["service_name"] : "",
    currency: typeof row["currency"] === "string" ? row["currency"] : "",
    usage_cost: typeof row["usage_cost"] === "number" ? row["usage_cost"] : 0,
    credits_amount:
      typeof row["credits_amount"] === "number" ? row["credits_amount"] : 0,
  };
}

export async function queryMonthlyCosts(
  params: BillingQueryParams,
): Promise<BillingQueryResult> {
  if (
    !Number.isInteger(params.months) ||
    params.months < 1 ||
    params.months > 60
  ) {
    throw new Error(
      `months must be a positive integer between 1 and 60, got: ${String(params.months)}`,
    );
  }

  assertSafeIdentifier(params.project, "BILLING_BIGQUERY_PROJECT");
  assertSafeIdentifier(params.dataset, "BILLING_BIGQUERY_DATASET");
  assertSafeIdentifier(params.table, "BILLING_BIGQUERY_TABLE");

  const { BigQuery } = await import("@google-cloud/bigquery");
  const bq = new BigQuery({ projectId: params.project });

  const tableRef = `\`${params.project}.${params.dataset}.${params.table}\``;

  // Exclude the current partial month unless explicitly requested.
  const currentMonthClause = params.includeCurrentMonth
    ? ""
    : `AND FORMAT_TIMESTAMP('%Y-%m', usage_start_time) < FORMAT_DATE('%Y-%m', CURRENT_DATE())`;

  // Usage cost per service per month, matching the GCP console "Usage cost" column.
  // This is the gross cost before any credits (free tier, discounts, etc.).
  // ROUND at query time to avoid floating-point drift from repeated summation.
  const query = `
    SELECT
      FORMAT_TIMESTAMP('%Y-%m', usage_start_time) AS month,
      service.description AS service_name,
      currency,
      ROUND(SUM(cost), 2) AS usage_cost,
      ROUND(SUM(IFNULL(
        (SELECT SUM(c.amount) FROM UNNEST(credits) AS c),
        0
      )), 2) AS credits_amount
    FROM ${tableRef}
    WHERE DATE(usage_start_time) >= DATE_SUB(
      DATE_TRUNC(CURRENT_DATE(), MONTH),
      INTERVAL ${params.months} MONTH
    )
    ${currentMonthClause}
    GROUP BY month, service_name, currency
    ORDER BY month DESC, usage_cost DESC
  `;

  const [rows] = await bq.query({ query, location: params.location });

  if (rows.length === 0) {
    return { currency: "USD", months: [] };
  }

  const typedRows = rows
    .filter(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && !Array.isArray(r),
    )
    .map(extractRow);

  // Reject mixed-currency exports — the report cannot produce a unified total.
  const currencies = new Set(typedRows.map((r) => r.currency));
  if (currencies.size > 1) {
    throw new Error(
      `Multiple currencies in billing export: ${[...currencies].join(", ")}. Cannot produce a unified cost report.`,
    );
  }
  const currency = typedRows[0]?.currency ?? "USD";

  // Group rows by month, keeping only services with positive gross spend.
  const monthMap = new Map<
    string,
    { name: string; cost: number; credits: number }[]
  >();
  for (const row of typedRows) {
    const cost = typeof row.usage_cost === "number" ? row.usage_cost : 0;
    if (!Number.isFinite(cost) || cost <= 0) continue;
    // Credits are negative in BigQuery; store as positive (discount amount).
    const credits = Math.round(-row.credits_amount * 100) / 100;
    const services = monthMap.get(row.month);
    if (services) {
      services.push({ name: row.service_name, cost, credits });
    } else {
      monthMap.set(row.month, [{ name: row.service_name, cost, credits }]);
    }
  }

  // Build entries sorted newest-first; services already sorted by BigQuery (usage_cost DESC).
  const months: MonthlyBillingEntry[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, services]) => {
      const total =
        Math.round(services.reduce((sum, s) => sum + s.cost, 0) * 100) / 100;
      const totalCredits =
        Math.round(services.reduce((sum, s) => sum + s.credits, 0) * 100) / 100;
      return {
        month,
        total,
        ...(totalCredits > 0 ? { totalCredits } : {}),
        byService: services.map((s) => ({
          name: s.name,
          cost: s.cost,
          ...(s.credits > 0 ? { credits: s.credits } : {}),
        })),
      };
    });

  return { currency, months };
}
