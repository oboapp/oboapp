#!/usr/bin/env tsx
/**
 * Sends an existing message to all notification-enabled devices for one user.
 *
 * The default is a dry run. Pass --execute to send through Firebase Cloud
 * Messaging without changing the normal notification-processing state.
 *
 * Usage:
 *   pnpm send-test-notification --user-id <id> --message-id <id>
 *   pnpm send-test-notification --user-id <id> --message-id <id> --execute
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { logger } from "@/lib/logger";
import { verifyDbEnv, verifyEnvSet } from "@/lib/verify-env";

interface Options {
  readonly userId: string;
  readonly messageId: string;
  readonly execute?: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

async function main(options: Options): Promise<void> {
  verifyEnvSet(["APP_URL", "FIREBASE_SERVICE_ACCOUNT_KEY"]);
  verifyDbEnv();

  const { getDb, closeDb } = await import("@/lib/db");
  const { adminApp } = await import("@/lib/firebase-admin");
  const { getMessaging } = await import("firebase-admin/messaging");
  const { sendTestNotification } =
    await import("@/notifications/test-notification");

  try {
    const db = await getDb();
    const result = await sendTestNotification(
      db,
      getMessaging(adminApp),
      options.userId,
      options.messageId,
      options.execute === true,
    );

    if (result.status === "message-not-found") {
      throw new Error(`Message "${options.messageId}" was not found.`);
    }

    if (result.status === "dry-run") {
      logger.info("Test notification dry run", {
        userId: options.userId.substring(0, 8),
        messageId: options.messageId,
        devices: result.deviceCount,
        sourceIcon: result.sourceIcon,
      });
      return;
    }

    logger.info("Test notification sent", {
      userId: options.userId.substring(0, 8),
      messageId: options.messageId,
      devices: result.deviceCount,
      devicesSuccessful: result.successCount,
      sourceIcon: result.sourceIcon,
    });
  } finally {
    await closeDb();
  }
}

const program = new Command();

program
  .name("send-test-notification")
  .description(
    "Send one existing message to all registered devices for a selected user",
  )
  .requiredOption("--user-id <id>", "The notification recipient's user ID")
  .requiredOption("--message-id <id>", "The existing message ID to send")
  .option("--execute", "Send the notification (default is a safe dry run)")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm send-test-notification --user-id <id> --message-id <id>
  $ pnpm send-test-notification --user-id <id> --message-id <id> --execute
`,
  )
  .action(async (options: Options) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    await main(options);
  });

program.parseAsync().catch((error: unknown) => {
  logger.error("Test notification command failed", {
    error: getErrorMessage(error),
  });
  process.exitCode = 1;
});
