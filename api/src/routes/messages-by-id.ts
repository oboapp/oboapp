import { Hono } from "hono";
import { getDb } from "../lib/db";
import { recordToMessage } from "../lib/doc-to-message";
import { apiKeyAuth } from "../middleware/api-key";
import { isValidMessageId } from "@oboapp/shared";

/**
 * Strip a trailing split-index suffix (e.g. "-1", "-2") from a
 * source-document-style ID so we can query by sourceDocumentId.
 */
function stripSplitSuffix(id: string): string {
  return id.replace(/-\d+$/, "");
}

export const messageByIdRoute = new Hono();

messageByIdRoute.get("/messages/by-id", apiKeyAuth, async (c) => {
  try {
    const id = c.req.query("id");

    if (!id) {
      return c.json({ error: "Missing id parameter" }, 400);
    }

    const db = await getDb();

    // Primary: look up by 8-char message ID
    if (isValidMessageId(id)) {
      const doc = await db.messages.findById(id);
      if (doc) {
        return c.json({ message: recordToMessage(doc) });
      }
      return c.json({ error: "Message not found" }, 404);
    }

    // Fallback: treat the id as a sourceDocumentId (strip optional "-N" suffix)
    const sourceDocId = stripSplitSuffix(id);
    const docs = await db.messages.findBySourceDocumentIds([sourceDocId]);

    if (docs.length > 0) {
      return c.json({ message: recordToMessage(docs[0]) });
    }

    return c.json({ error: "Message not found" }, 404);
  } catch (error) {
    console.error("Error fetching message by id:", error);
    return c.json({ error: "Failed to fetch message" }, 500);
  }
});
