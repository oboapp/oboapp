import type { Context, Next } from "hono";
import { getDb } from "@/lib/db";

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
  try {
    const db = await getDb();
    const client = await db.apiClients.findByApiKey(normalizedKey);
    return client !== null;
  } catch (error) {
    console.error(
      "validateApiKey: failed to validate API key due to an internal error",
      error,
    );
    return false;
  }
}

export async function apiKeyAuth(c: Context, next: Next) {
  const key = c.req.header("x-api-key");
  if (!key || !(await validateApiKey(key))) {
    return c.json(
      {
        error:
          "Invalid or missing API key. Provide a valid X-Api-Key request header.",
      },
      401,
    );
  }
  await next();
}
