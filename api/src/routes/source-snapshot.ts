import { Hono } from "hono";
import { SOURCES } from "@oboapp/shared";
import { getDb } from "../lib/db";
import {
  getRequiredLocality,
  LOCALITY_ENV_ERROR_MESSAGE,
} from "../lib/locality";
import { apiKeyAuth } from "../middleware/api-key";
import { rateLimit } from "../middleware/rate-limit";
import { usageMetrics } from "../middleware/usage-metrics";
import { SourceSnapshotResponseSchema } from "../schema/response";

export const sourceSnapshotRoute = new Hono();

sourceSnapshotRoute.get(
  "/sources/:sourceId/snapshot",
  apiKeyAuth,
  rateLimit,
  usageMetrics,
  async (c) => {
    let locality: string;
    try {
      locality = getRequiredLocality();
    } catch {
      console.error("Missing LOCALITY configuration for source snapshot");
      return c.json({ error: LOCALITY_ENV_ERROR_MESSAGE }, 500);
    }

    const sourceId = c.req.param("sourceId");
    const source = SOURCES.find((candidate) => {
      return candidate.id === sourceId && candidate.localities.includes(locality);
    });

    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    try {
      const db = await getDb();
      const snapshot = await db.sourceSnapshots.findLatest(source.id, locality);

      if (!snapshot) {
        return c.json(
          { error: "No successful snapshot available for this source" },
          404,
        );
      }

      const response = SourceSnapshotResponseSchema.parse({
        snapshot: {
          sourceType: source.id,
          locality,
          count: snapshot.count,
          observedAt: snapshot.observedAt,
          sourceUrl: source.url,
        },
      });

      c.header("Cache-Control", "private, max-age=60");
      return c.json(response);
    } catch (error) {
      console.error("Error fetching source snapshot:", error);
      return c.json({ error: "Failed to fetch source snapshot" }, 500);
    }
  },
);
