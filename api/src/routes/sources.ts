import { Hono } from "hono";
import { SOURCES } from "@oboapp/shared";
import { apiKeyAuth } from "../middleware/api-key";
import { rateLimit } from "../middleware/rate-limit";
import { usageMetrics } from "../middleware/usage-metrics";
import {
  getRequiredLocality,
  LOCALITY_ENV_ERROR_MESSAGE,
} from "../lib/locality";

export const sourcesRoute = new Hono();

sourcesRoute.get("/sources", apiKeyAuth, rateLimit, usageMetrics, (c) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL;
  if (!baseUrl) {
    return c.json(
      { error: "NEXT_PUBLIC_BASE_URL or BASE_URL is required" },
      500,
    );
  }
  let locality: string;
  try {
    locality = getRequiredLocality();
  } catch {
    console.error("Missing LOCALITY configuration for /v1/sources");
    return c.json({ error: LOCALITY_ENV_ERROR_MESSAGE }, 500);
  }

  const sources = SOURCES.filter((source) =>
    source.localities.includes(locality),
  ).map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    logoUrl: `${baseUrl}/sources/${source.id}.png`,
    locality,
  }));

  return c.json({ sources });
});
