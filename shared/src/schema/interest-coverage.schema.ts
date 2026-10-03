import { z } from "zod";
import { BOUNDS } from "../bounds";
import { INTEREST_GRID_METERS, makeInterestCoverageGrid } from "../interest-coverage-grid";
import { makeInterestRaster } from "../interest-coverage-raster";

export const INTEREST_REPORT_PATH = "interests/report.json";
export const INTEREST_PRIVACY_MIN_USERS = 10;

const CountBandSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
}).strict().refine((band) => band.max === band.min + 9 && band.min % 10 === 0);

const LegacyInterestCoverageReportSchema = z.object({
  version: z.literal(1),
  locality: z.string().min(1),
  generatedAt: z.iso.datetime(),
  gridMeters: z.literal(INTEREST_GRID_METERS),
  status: z.enum(["available", "unavailable"]),
  summary: z.object({
    interests: CountBandSchema,
    users: CountBandSchema,
  }).strict().nullable(),
  cells: z.array(z.object({
    // Fixed-grid bounds, never individual interest coordinates.
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    users: CountBandSchema,
  }).strict().refine((cell) => cell.north > cell.south && cell.east > cell.west && cell.users.min >= INTEREST_PRIVACY_MIN_USERS)),
}).strict().superRefine((report, ctx) => {
  const valid = report.status === "available"
    ? report.summary !== null && report.summary.users.min >= INTEREST_PRIVACY_MIN_USERS && report.cells.length > 0
    : report.summary === null && report.cells.length === 0;
  if (!valid || (report.summary !== null && report.summary.interests.min < report.summary.users.min)) ctx.addIssue({ code: "custom", message: "Unsafe report availability state" });
  if (!BOUNDS[report.locality]) {
    ctx.addIssue({ code: "custom", message: "Unknown report locality" });
    return;
  }
  const grid = makeInterestCoverageGrid(report.locality);
  const seen = new Set<number>();
  for (const cell of report.cells) {
    const index = grid.cells.findIndex((expected) => expected.south === cell.south && expected.west === cell.west && expected.north === cell.north && expected.east === cell.east);
    if (index < 0 || seen.has(index)) ctx.addIssue({ code: "custom", message: "Non-grid or duplicate report cell" });
    seen.add(index);
  }
});

export const InterestCoverageImageReportSchema = z.object({
  version: z.literal(2),
  locality: z.string().min(1),
  generatedAt: z.iso.datetime(),
  status: z.enum(["available", "unavailable"]),
  summary: z.object({ interests: CountBandSchema, users: CountBandSchema }).strict().nullable(),
  image: z.object({
    // Embedded PNG keeps image and metadata in one atomic, cacheable snapshot.
    dataUrl: z.string().max(8_000_000).regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/),
    width: z.number().int().positive().max(2048),
    height: z.number().int().positive().max(2048),
  }).strict().nullable(),
}).strict().superRefine((report, ctx) => {
  const valid = report.status === "available"
    ? report.summary !== null && report.summary.users.min >= INTEREST_PRIVACY_MIN_USERS && report.image !== null
    : report.summary === null && report.image === null;
  if (!valid || (report.summary !== null && report.summary.interests.min < report.summary.users.min)) {
    ctx.addIssue({ code: "custom", message: "Invalid image report availability state" });
  }
  if (!BOUNDS[report.locality]) {
    ctx.addIssue({ code: "custom", message: "Unknown report locality" });
    return;
  }
  const raster = makeInterestRaster(report.locality);
  if (report.image && (report.image.width !== raster.width || report.image.height !== raster.height)) {
    ctx.addIssue({ code: "custom", message: "Image dimensions must match the fixed locality raster" });
  }
});

// Read legacy snapshots during rollout; the generator only writes version 2.
export const InterestCoverageReportSchema = z.union([LegacyInterestCoverageReportSchema, InterestCoverageImageReportSchema]);
export type InterestCoverageReport = z.infer<typeof InterestCoverageReportSchema>;
export type InterestCoverageImageReport = z.infer<typeof InterestCoverageImageReportSchema>;
export type LegacyInterestCoverageReport = z.infer<typeof LegacyInterestCoverageReportSchema>;

export function countBand(count: number) {
  const min = Math.floor(count / 10) * 10;
  return { min, max: min + 9 };
}
