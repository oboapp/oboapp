import { Hono } from "hono";
import { SOURCES } from "@oboapp/shared";
import { apiKeyAuth } from "@/middleware/api-key";

export const sourcesRoute = new Hono();

sourcesRoute.get("/sources", apiKeyAuth, (c) => {
  const baseUrl = process.env.BASE_URL || "https://oboapp.online";

  const sources = SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    logoUrl: `${baseUrl}/sources/${source.id}.png`,
    locality: source.localities[0] ?? "",
  }));

  return c.json({ sources });
});
