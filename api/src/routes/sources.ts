import { Hono } from "hono";
import { SOURCES } from "@oboapp/shared";
import { apiKeyAuth } from "../middleware/api-key";

export const sourcesRoute = new Hono();

sourcesRoute.get("/sources", apiKeyAuth, (c) => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    "https://oboapp.online";
  const locality = process.env.LOCALITY || "bg.sofia";

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
