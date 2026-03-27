import type { Context, Next } from "hono";
import { getDb } from "../lib/db";

let cachedEnvKeys: Set<string> | null = null;

function getEnvKeys(): Set<string> {
  if (cachedEnvKeys) return cachedEnvKeys;
  const apiKeys = process.env.PUBLIC_API_KEYS ?? "";
  cachedEnvKeys = new Set(
    apiKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  return cachedEnvKeys;
}

async function validateApiKey(key: string): Promise<boolean> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return false;

  // Fast path: check env-var keys (no DB round-trip)
  if (getEnvKeys().has(normalizedKey)) return true;

  // DB path: look up the key in the apiClients collection
  const db = await getDb();
  const client = await db.apiClients.findByApiKey(normalizedKey);
  return client !== null;
}

export async function apiKeyAuth(c: Context, next: Next) {
  const key = c.req.header("x-api-key");
  if (!key) {
    return c.json(
      {
        error:
          "Invalid or missing API key. Provide a valid X-Api-Key request header.",
      },
      401,
    );
  }

  try {
    if (await validateApiKey(key)) {
      await next();
      return;
    }
  } catch (error) {
    console.error(
      "apiKeyAuth: failed to validate API key due to an internal error",
      error,
    );
    return c.json({ error: "Internal server error" }, 500);
  }

  return c.json(
    {
      error:
        "Invalid or missing API key. Provide a valid X-Api-Key request header.",
    },
    401,
  );
}
