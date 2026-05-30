import { getDb } from "@/lib/db";
import { generateMessageId } from "@/lib/message-id-utils";

/**
 * Maximum number of attempts to generate a unique message ID before failing.
 * With 62^8 possible combinations, collisions are extremely rare.
 */
const MAX_MESSAGE_ID_GENERATION_ATTEMPTS = 5;

/**
 * Error codes indicating a document already exists.
 * Used across both Firestore and MongoDB adapters.
 */
const ALREADY_EXISTS_CODES = new Set<string | number>([
  "already-exists",
  "ALREADY_EXISTS",
  6, // Numeric code for Firestore ALREADY_EXISTS
]);

/**
 * Step 1: Store the incoming message in the database.
 * Always uses an 8-character alphanumeric ID as the document ID.
 * The document ID is used in URLs (e.g., /m/aB3xYz12).
 */
export async function storeIncomingMessage(
  text: string,
  locality: string,
  source: string = "web-interface",
  sourceUrl?: string,
  crawledAt?: Date,
  sourceDocumentId?: string,
): Promise<string> {
  const db = await getDb();

  const docData: Record<string, unknown> = {
    text,
    locality,
    source,
    // New messages default to non-AI until the filter/split stage marks them.
    aiProcessed: false,
    createdAt: new Date(),
    crawledAt: crawledAt ?? new Date(),
    // Notify pipeline queries explicit false; always initialize this flag.
    notificationsSent: false,
  };

  if (sourceUrl) {
    docData.sourceUrl = sourceUrl;
  }

  if (sourceDocumentId) {
    docData.sourceDocumentId = sourceDocumentId;
  }

  // Atomically create document with retry on collision
  for (
    let attempt = 0;
    attempt < MAX_MESSAGE_ID_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const messageId = generateMessageId();
    try {
      await db.messages.createOne(messageId, docData);
      return messageId;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (typeof err.code === "string" || typeof err.code === "number") &&
        ALREADY_EXISTS_CODES.has(err.code)
      ) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    "Failed to generate a unique message ID after multiple attempts.",
  );
}
