import type { OboDb } from "@oboapp/db";
import { Interest } from "@/lib/types";
import { logger } from "@/lib/logger";
import {
  getString,
  getOptionalString,
  getNumber,
  getCoordinates,
} from "@/lib/record-fields";

function toDateOrString(value: unknown): Date | string {
  if (value instanceof Date) return value;
  if (typeof value === "string") return value;
  return new Date();
}

/**
 * Get all user interests
 */
export async function getAllInterests(db: OboDb): Promise<Interest[]> {
  logger.info("Fetching user interests");

  const docs = await db.interests.findMany();

  const interests: Interest[] = docs.map((data) => ({
    id: getString(data._id),
    userId: getString(data.userId),
    coordinates: getCoordinates(data.coordinates) ?? { lat: 0, lng: 0 },
    radius: getNumber(data.radius),
    label: getOptionalString(data.label),
    color: getOptionalString(data.color),
    createdAt: toDateOrString(data.createdAt),
    updatedAt: toDateOrString(data.updatedAt),
  }));

  logger.info("Found user interests", {
    count: interests.length,
    uniqueUsers: new Set(interests.map((i) => i.userId)).size,
  });

  return interests;
}
