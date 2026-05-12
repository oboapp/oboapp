export function hasReportPagesEnabled() {
  return Boolean(process.env.GCS_GENERIC_BUCKET?.trim());
}
