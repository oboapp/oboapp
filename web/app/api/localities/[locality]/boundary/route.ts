import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { BOUNDS } from "@oboapp/shared";
import { z } from "zod";

const positionSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ringSchema = z.array(positionSchema).min(4).refine((ring) => {
  const first = ring[0];
  const last = ring.at(-1);
  return first !== undefined && last !== undefined &&
    first[0] === last[0] && first[1] === last[1];
});
const polygonSchema = z.array(ringSchema).min(1);
const boundarySchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("Polygon"),
          coordinates: polygonSchema,
        }),
        z.object({
          type: z.literal("MultiPolygon"),
          coordinates: z.array(polygonSchema).min(1),
        }),
      ]),
      properties: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ).min(1),
});

interface BoundaryRouteContext {
  params: Promise<{ locality: string }>;
}

export async function GET(_request: Request, context: BoundaryRouteContext) {
  const { locality } = await context.params;

  if (!Object.hasOwn(BOUNDS, locality)) {
    return NextResponse.json({ error: "Unknown locality" }, { status: 404 });
  }

  try {
    const boundaryPath = resolve(
      process.cwd(),
      "..",
      "ingest",
      "localities",
      `${locality}.geojson`,
    );
    const content = await readFile(boundaryPath, "utf-8");
    const boundary = boundarySchema.parse(JSON.parse(content));

    return NextResponse.json(boundary, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return NextResponse.json(
        { error: "Locality boundary unavailable" },
        { status: 404 },
      );
    }

    console.error("Failed to load locality boundary", { locality, error });
    return NextResponse.json(
      { error: "Failed to load locality boundary" },
      { status: 500 },
    );
  }
}
