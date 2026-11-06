import type { DbClient } from "@oboapp/db";
import { z } from "zod";
import type { FacebookConnectionRecord, FacebookOAuthSession } from "./types";
import { FACEBOOK_SESSION_DURATION_MS } from "./config";

const sessions = "facebookOAuthSessions";
const connections = "facebookPageConnections";
const receipts = "facebookDeletionReceipts";
const startLimits = "facebookOAuthStartLimits";
const revocations = "facebookUserRevocations";
const identifier = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const phase = z.enum(["authorizing", "exchanging", "selecting", "saving", "complete", "failed"]);
const page = z.object({
  id: z.string().regex(/^[1-9]\d{0,31}$/),
  name: z.string().min(1).max(1000),
}).strict();
const sessionFields = {
  userTokenCipher: z.string().min(1).max(32768).nullable(),
  userHash: identifier.nullable(),
  pages: z.array(page).max(500),
  pageName: z.string().min(1).max(1000).nullable(),
  connectionId: identifier.nullable(),
};
const sessionSchema = z.object({
  id: identifier,
  browserHash: identifier,
  expiresAt: z.number().int().nonnegative(),
  phase,
  ...sessionFields,
}).strict();
const patchSchema = z.object(sessionFields).partial().strict();
const connectionSchema = z.object({
  id: identifier,
  pageId: z.string().regex(/^[1-9]\d{0,31}$/),
  pageName: z.string().min(1).max(1000),
  userHash: identifier,
  secretVersion: z.string().regex(/^projects\/[A-Za-z0-9-]+\/secrets\/[A-Za-z0-9_-]+\/versions\/[1-9]\d*$/),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(["pending_review", "revoked"]),
  collectionEnabled: z.literal(false),
}).strict();
const receiptSchema = z.object({ completedAt: z.number().int().nonnegative() }).strict();
const sessionInputSchema = z.object({
  browserHash: identifier,
  expiresAt: z.number().int().nonnegative(),
}).strict();
const startLimitSchema = z.object({
  key: identifier,
  window: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(5),
  revision: z.string(),
  expiresAt: z.number().int().nonnegative(),
}).strict();
const revocationSchema = z.object({
  userHash: identifier,
  revokedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  revision: identifier,
}).strict();

export type FacebookSessionPatch = Partial<Pick<FacebookOAuthSession,
  "userTokenCipher" | "userHash" | "pages" | "pageName" | "connectionId"
>>;

export class FacebookConnectStoreError extends Error {
  constructor(readonly code: "invalid_record" | "unavailable" | "atomic_unavailable" | "limit_exceeded") {
    super("Facebook connection storage failed");
    this.name = "FacebookConnectStoreError";
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new FacebookConnectStoreError("invalid_record");
  }
  return result.data;
}

function storedData(value: Record<string, unknown>): Record<string, unknown> {
  const { _id: _databaseId, expireTime: _expireTime, ...data } = value;
  return data;
}

async function operation<T>(perform: () => Promise<T>): Promise<T> {
  try {
    return await perform();
  } catch (error) {
    if (error instanceof FacebookConnectStoreError) {
      throw error;
    }
    throw new FacebookConnectStoreError("unavailable");
  }
}

/** Persist connection metadata through Obo's configured database adapters. */
export function createFacebookConnectStore(client: DbClient) {
  return {
    async getUserRevocation(userHash: string): Promise<number | null> {
      parse(identifier, userHash);
      return operation(async () => {
        const data = await client.findOne(revocations, userHash);
        if (data === null) {
          return null;
        }
        const record = parse(revocationSchema, storedData(data));
        if (record.userHash !== userHash || record.revision !== String(record.revokedAt)) {
          throw new FacebookConnectStoreError("invalid_record");
        }
        return record.revokedAt;
      });
    },

    async recordUserRevocation(userHash: string, now: number): Promise<void> {
      parse(identifier, userHash);
      parse(z.number().int().nonnegative(), now);
      if (!client.compareAndUpdate) {
        throw new FacebookConnectStoreError("atomic_unavailable");
      }
      const compareAndUpdate = client.compareAndUpdate.bind(client);
      const expiresAt = now + 2 * FACEBOOK_SESSION_DURATION_MS;
      const record = parse(revocationSchema, {
        userHash, revokedAt: now, expiresAt, revision: String(now),
      });
      const update = { ...record, expireTime: new Date(expiresAt) };
      await operation(async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const current = await client.findOne(revocations, userHash);
          if (current === null) {
            try {
              await client.createOne(revocations, update, userHash);
              return;
            } catch {
              continue;
            }
          }
          const previous = parse(revocationSchema, storedData(current));
          if (previous.userHash !== userHash || previous.revision !== String(previous.revokedAt)) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          if (previous.revokedAt >= now) {
            return;
          }
          if (await compareAndUpdate(revocations, userHash, "revision", previous.revision, update)) {
            return;
          }
        }
        throw new FacebookConnectStoreError("unavailable");
      });
    },

    async consumeStartLimit(key: string, now: number): Promise<boolean> {
      parse(identifier, key);
      parse(z.number().int().nonnegative(), now);
      if (!client.compareAndUpdate) {
        throw new FacebookConnectStoreError("atomic_unavailable");
      }
      const compareAndUpdate = client.compareAndUpdate.bind(client);
      const window = Math.floor(now / 600000);
      const id = `${key}_${window}`;
      return operation(async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const data = await client.findOne(startLimits, id);
          if (data === null) {
            try {
              await client.createOne(startLimits, {
                key,
                window,
                count: 1,
                revision: "1",
                expiresAt: (window + 1) * 600000,
                expireTime: new Date((window + 1) * 600000),
              }, id);
              return true;
            } catch (error) {
              const duplicate = error instanceof Error && "code" in error &&
                (error.code === 6 || error.code === 11000 || error.code === "already-exists");
              if (!duplicate) {
                throw new FacebookConnectStoreError("unavailable");
              }
              continue;
            }
          }
          const record = parse(startLimitSchema, storedData(data));
          if (record.key !== key || record.window !== window || record.revision !== String(record.count)) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          if (record.count >= 5) {
            return false;
          }
          const count = record.count + 1;
          if (await compareAndUpdate(startLimits, id, "revision", record.revision, { count, revision: String(count) })) {
            return true;
          }
        }
        return false;
      });
    },

    async createSession(id: string, input: { browserHash: string; expiresAt: number }): Promise<void> {
      const fields = parse(sessionInputSchema, input);
      const record = parse(sessionSchema, {
        id,
        ...fields,
        phase: "authorizing",
        userTokenCipher: null,
        userHash: null,
        pages: [],
        pageName: null,
        connectionId: null,
      });
      await operation(async () => {
        await client.createOne(sessions, { ...record, expireTime: new Date(record.expiresAt) }, id);
      });
    },

    async getSession(id: string): Promise<FacebookOAuthSession | null> {
      parse(identifier, id);
      return operation(async () => {
        const data = await client.findOne(sessions, id);
        if (data === null) {
          return null;
        }
        const record = parse(sessionSchema, storedData(data));
        if (record.id !== id) {
          throw new FacebookConnectStoreError("invalid_record");
        }
        return record;
      });
    },

    async transitionSession(
      id: string,
      expectedPhase: FacebookOAuthSession["phase"],
      nextPhase: FacebookOAuthSession["phase"],
      patch: FacebookSessionPatch = {},
    ): Promise<boolean> {
      parse(identifier, id);
      parse(phase, expectedPhase);
      parse(phase, nextPhase);
      const data = parse(patchSchema, patch);
      if (!client.compareAndUpdate) {
        throw new FacebookConnectStoreError("atomic_unavailable");
      }
      const compareAndUpdate = client.compareAndUpdate.bind(client);
      return operation(async () => {
        return compareAndUpdate(sessions, id, "phase", expectedPhase, { ...data, phase: nextPhase });
      });
    },

    async updateSession(id: string, patch: FacebookSessionPatch): Promise<void> {
      parse(identifier, id);
      const data = parse(patchSchema, patch);
      await operation(async () => {
        await client.updateOne(sessions, id, data);
      });
    },

    async setSessionCleanupIntent(id: string, keep: boolean): Promise<void> {
      parse(identifier, id);
      await operation(async () => {
        const current = await client.findOne(sessions, id);
        if (current === null) {
          if (keep) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          return;
        }
        const record = parse(sessionSchema, storedData(current));
        if (record.id !== id) {
          throw new FacebookConnectStoreError("invalid_record");
        }
        await client.updateOne(sessions, id, {
          userTokenCipher: null,
          pages: [],
          expireTime: keep ? null : new Date(record.expiresAt),
        });
      });
    },

    async createConnection(id: string, record: FacebookConnectionRecord): Promise<void> {
      const data = parse(connectionSchema, record);
      if (data.id !== id) {
        throw new FacebookConnectStoreError("invalid_record");
      }
      await operation(async () => {
        await client.createOne(connections, data, id);
      });
    },

    async trackConnectionCleanup(id: string, record: FacebookConnectionRecord): Promise<void> {
      const data = parse(connectionSchema, { ...record, status: "revoked", collectionEnabled: false });
      if (data.id !== id) {
        throw new FacebookConnectStoreError("invalid_record");
      }
      await operation(async () => {
        try {
          await client.createOne(connections, data, id);
          return;
        } catch {
          const current = await client.findOne(connections, id);
          if (current === null) {
            throw new FacebookConnectStoreError("unavailable");
          }
          const previous = parse(connectionSchema, storedData(current));
          if (previous.id !== id || previous.secretVersion !== data.secretVersion ||
              previous.userHash !== data.userHash || previous.pageId !== data.pageId) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          if (previous.status !== "revoked") {
            await client.updateOne(connections, id, { status: "revoked", collectionEnabled: false });
          }
        }
      });
    },

    async getConnectionsForUser(userHash: string): Promise<FacebookConnectionRecord[]> {
      parse(identifier, userHash);
      return operation(async () => {
        const records = await client.findMany(connections, {
          where: [{ field: "userHash", op: "==", value: userHash }],
          limit: 100,
        });
        if (records.length >= 100) {
          throw new FacebookConnectStoreError("limit_exceeded");
        }
        return records.map((record) => {
          const data = parse(connectionSchema, storedData(record));
          if (data.userHash !== userHash) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          return data;
        });
      });
    },

    async revokeConnection(id: string): Promise<void> {
      parse(identifier, id);
      await operation(async () => {
        await client.updateOne(connections, id, { status: "revoked", collectionEnabled: false });
      });
    },

    async deleteConnection(id: string): Promise<void> {
      parse(identifier, id);
      await operation(async () => {
        await client.deleteOne(connections, id);
      });
    },

    async hasSavingSessionForUser(userHash: string): Promise<boolean> {
      parse(identifier, userHash);
      return operation(async () => {
        const records = await client.findMany(sessions, {
          where: [
            { field: "userHash", op: "==", value: userHash },
            { field: "phase", op: "==", value: "saving" },
          ],
          limit: 1,
        });
        for (const record of records) {
          const data = parse(sessionSchema, storedData(record));
          if (data.userHash !== userHash || data.phase !== "saving") {
            throw new FacebookConnectStoreError("invalid_record");
          }
        }
        return records.length > 0;
      });
    },

    async getCleanupIntentIdsForUser(userHash: string): Promise<string[]> {
      parse(identifier, userHash);
      return operation(async () => {
        const records = await client.findMany(sessions, {
          where: [{ field: "userHash", op: "==", value: userHash }],
          limit: 100,
        });
        if (records.length >= 100) {
          throw new FacebookConnectStoreError("limit_exceeded");
        }
        const ids: string[] = [];
        for (const record of records) {
          const data = parse(sessionSchema, storedData(record));
          if (data.userHash !== userHash) {
            throw new FacebookConnectStoreError("invalid_record");
          }
          if (data.phase === "failed" && data.connectionId !== null) {
            ids.push(data.connectionId);
          }
        }
        return ids;
      });
    },

    async deleteSessionsForUser(userHash: string): Promise<number> {
      parse(identifier, userHash);
      return operation(async () => {
        return client.deleteMany(sessions, [{ field: "userHash", op: "==", value: userHash }]);
      });
    },

    async createDeletionReceipt(id: string, input: { completedAt: number }): Promise<void> {
      parse(identifier, id);
      const data = parse(receiptSchema, input);
      await operation(async () => {
        await client.createOne(receipts, data, id);
      });
    },

    async getDeletionReceipt(id: string): Promise<{ completedAt: number } | null> {
      parse(identifier, id);
      return operation(async () => {
        const data = await client.findOne(receipts, id);
        return data === null ? null : parse(receiptSchema, storedData(data));
      });
    },
  };
}

export type FacebookConnectStore = ReturnType<typeof createFacebookConnectStore>;
