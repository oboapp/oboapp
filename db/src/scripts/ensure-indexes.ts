import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

import { ensureIndexes } from "../indexes";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const mongoDatabase = process.env.MONGODB_DATABASE ?? "oboapp";
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    await ensureIndexes(client.db(mongoDatabase));
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error("Failed to ensure MongoDB indexes:", err);
  process.exit(1);
});