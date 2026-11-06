// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@oboapp/db";
import { createFacebookConnectStore } from "./store";
import {
  facebookCsrfToken,
  facebookUserHash,
  makeFacebookSession,
  hashFacebookValue,
} from "./crypto";
import {
  deleteFacebookUserConnections,
  finishFacebookAuthorization,
  selectFacebookPage,
  startFacebookConnection,
  type FacebookConnectionContext,
} from "./service";
import { exchangeFacebookCode, getFacebookAuthorization, getFacebookPageAccess } from "./client";

vi.mock("./client", () => {
  return {
    buildFacebookAuthorizationUrl: vi.fn(() => { return "https://www.facebook.com/dialog/oauth"; }),
    exchangeFacebookCode: vi.fn(),
    getFacebookAuthorization: vi.fn(),
    getFacebookPageAccess: vi.fn(),
    FacebookAuthorizationError: class extends Error {},
  };
});

const config = {
  appId: "123456", appSecret: "a".repeat(32), apiVersion: "v25.0",
  origin: "https://example.com", redirectUri: "https://example.com/api/integrations/facebook/callback",
  secretName: "projects/demo-project/secrets/facebook-pages",
};

function createTestDatabase(): DbClient {
  const records = new Map<string, Record<string, unknown>>();
  return {
    async findOne(collection, id) {
      return records.get(`${collection}/${id}`) || null;
    },
    async findMany(collection, options) {
      return [...records.entries()].filter(([key, record]) => {
        return key.startsWith(`${collection}/`) && options?.where?.every((clause) => {
          return record[clause.field] === clause.value;
        });
      }).map(([key, record]) => {
        return { ...record, _id: key.split("/")[1] };
      });
    },
    async createOne(collection, data, id) {
      const key = `${collection}/${id}`;
      if (records.has(key)) {
        throw new Error("exists");
      }
      records.set(key, { ...data });
      return id;
    },
    async updateOne(collection, id, data) {
      const key = `${collection}/${id}`;
      records.set(key, { ...records.get(key), ...data });
    },
    async compareAndUpdate(collection, id, field, expected, patch) {
      const key = `${collection}/${id}`;
      const record = records.get(key);
      if (!record || record[field] !== expected) {
        return false;
      }
      records.set(key, { ...record, ...patch });
      return true;
    },
    async deleteOne(collection, id) {
      records.delete(`${collection}/${id}`);
    },
    async deleteMany(collection, where) {
      let count = 0;
      for (const [key, record] of records) {
        if (key.startsWith(`${collection}/`) && where.every((clause) => {
          return record[clause.field] === clause.value;
        })) {
          records.delete(key);
          count++;
        }
      }
      return count;
    },
    insertOne: vi.fn(), batchWrite: vi.fn(), count: vi.fn(), close: vi.fn(),
  };
}

describe("Facebook connection lifecycle", () => {
  let context: FacebookConnectionContext;
  let session: ReturnType<typeof makeFacebookSession>;
  let database: DbClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createTestDatabase();
    context = {
      config,
      store: createFacebookConnectStore(database),
      secrets: {
        save: vi.fn().mockResolvedValue(`${config.secretName}/versions/1`),
        disable: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
      },
      now: () => { return 100000; },
    };
    session = makeFacebookSession();
    await context.store.createSession(session.sessionId, {
      browserHash: hashFacebookValue(session.browserSecret), expiresAt: 1000000,
    });
    vi.mocked(exchangeFacebookCode).mockResolvedValue({ accessToken: "user-test-token", expiresAt: null });
    vi.mocked(getFacebookAuthorization).mockResolvedValue({ userId: "987", pages: [{ id: "123", name: "Общинска страница", tasks: ["ANALYZE"] }] });
    vi.mocked(getFacebookPageAccess).mockResolvedValue({ pageId: "123", pageName: "Общинска страница", accessToken: "page-test-token" });
  });

  async function authorize() {
    await finishFacebookAuthorization(context, session.cookieValue, { state: session.state, code: "code", denied: false });
  }

  function selection() {
    return { pageId: "123", csrf: facebookCsrfToken(config, session.cookieValue) };
  }

  it("limits starts by network and sets up a browser-bound session", async () => {
    const result = await startFacebookConnection(context, "127.0.0.1");
    expect(result.location).toBe("https://www.facebook.com/dialog/oauth");
    expect(result.cookieValue).toMatch(/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/);
    for (let index = 0; index < 4; index++) {
      await startFacebookConnection(context, "127.0.0.1");
    }
    await expect(startFacebookConnection(context, "127.0.0.1")).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("rejects wrong state and browser before exchanging credentials", async () => {
    await expect(finishFacebookAuthorization(context, session.cookieValue, { state: "wrong", code: "code", denied: false })).rejects.toMatchObject({ code: "invalid" });
    const other = makeFacebookSession();
    await expect(finishFacebookAuthorization(context, `${session.sessionId}.${other.browserSecret}`, { state: session.state, code: "code", denied: false })).rejects.toMatchObject({ code: "invalid" });
    expect(exchangeFacebookCode).not.toHaveBeenCalled();
  });

  it("consumes state once and stores only an encrypted temporary user token", async () => {
    await authorize();
    const record = await context.store.getSession(session.sessionId);
    expect(record?.phase).toBe("selecting");
    expect(record?.userTokenCipher).not.toContain("user-test-token");
    expect(record?.pages).toEqual([{ id: "123", name: "Общинска страница" }]);
    await expect(authorize()).rejects.toMatchObject({ code: "invalid" });
    expect(exchangeFacebookCode).toHaveBeenCalledTimes(1);
  });

  it("handles cancellation and clears temporary data", async () => {
    await expect(finishFacebookAuthorization(context, session.cookieValue, { state: session.state, code: null, denied: true })).rejects.toMatchObject({ code: "cancelled" });
    expect((await context.store.getSession(session.sessionId))?.phase).toBe("failed");
    expect(exchangeFacebookCode).not.toHaveBeenCalled();
  });

  it("rejects forged selections and CSRF before reading Page credentials", async () => {
    await authorize();
    await expect(selectFacebookPage(context, session.cookieValue, { ...selection(), pageId: "456" })).rejects.toMatchObject({ code: "invalid" });
    await expect(selectFacebookPage(context, session.cookieValue, { ...selection(), csrf: "wrong" })).rejects.toMatchObject({ code: "invalid" });
    expect(getFacebookPageAccess).not.toHaveBeenCalled();
  });

  it("saves a pending connection without credentials in metadata and wipes temporary token", async () => {
    await authorize();
    await selectFacebookPage(context, session.cookieValue, selection());
    const records = await context.store.getConnectionsForUser(facebookUserHash(config, "987"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pageId: "123", status: "pending_review", collectionEnabled: false });
    expect(JSON.stringify(records)).not.toContain("page-test-token");
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "complete", userTokenCipher: null, pages: [] });
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toMatchObject({ code: "invalid" });
  });

  it("retires a saved credential when metadata persistence fails", async () => {
    await authorize();
    vi.spyOn(context.store, "createConnection").mockRejectedValue(new Error("database unavailable"));
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toThrow("database unavailable");
    expect(context.secrets.destroy).toHaveBeenCalledWith(`${config.secretName}/versions/1`);
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "failed", userTokenCipher: null });
  });

  it("destroys credentials and deletes connection metadata for verified user identity", async () => {
    await authorize();
    await selectFacebookPage(context, session.cookieValue, selection());
    const code = await deleteFacebookUserConnections(context, "987");
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await context.store.getConnectionsForUser(facebookUserHash(config, "987"))).toEqual([]);
    expect(await context.store.getSession(session.sessionId)).toBeNull();
    expect(await context.store.getDeletionReceipt(code)).toEqual({ completedAt: 100000 });
  });

  it("fences authorization already in flight when a deletion callback arrives", async () => {
    vi.mocked(getFacebookAuthorization).mockImplementationOnce(async () => {
      await deleteFacebookUserConnections(context, "987");
      return { userId: "987", pages: [{ id: "123", name: "Общинска страница", tasks: ["ANALYZE"] }] };
    });
    await expect(authorize()).rejects.toMatchObject({ code: "invalid" });
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "failed", userTokenCipher: null });
    expect(context.secrets.save).not.toHaveBeenCalled();
  });

  it("defers deletion completion and rejects an in-flight selection before saving a credential", async () => {
    await authorize();
    const receipt = vi.spyOn(context.store, "createDeletionReceipt");
    vi.mocked(getFacebookPageAccess).mockImplementationOnce(async () => {
      await expect(deleteFacebookUserConnections(context, "987")).rejects.toMatchObject({ code: "storage" });
      return { pageId: "123", pageName: "Общинска страница", accessToken: "page-test-token" };
    });
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toMatchObject({ code: "invalid" });
    expect(context.secrets.save).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "failed", userTokenCipher: null, connectionId: null });
    await deleteFacebookUserConnections(context, "987");
    expect(receipt).toHaveBeenCalledTimes(1);
  });

  it("retains a revoked credential record when compensation fails and retries it on deletion", async () => {
    await authorize();
    vi.spyOn(context.store, "createConnection").mockRejectedValue(new Error("initial metadata failure"));
    vi.mocked(context.secrets.destroy).mockRejectedValue(new Error("cloud unavailable"));
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toMatchObject({ code: "storage" });
    expect(context.secrets.destroy).toHaveBeenCalledTimes(2);
    expect(context.secrets.disable).toHaveBeenCalledWith(`${config.secretName}/versions/1`);
    expect(await context.store.getConnectionsForUser(facebookUserHash(config, "987"))).toMatchObject([
      { id: session.sessionId, status: "revoked", collectionEnabled: false },
    ]);
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "failed", userTokenCipher: null });
    expect((await database.findOne("facebookOAuthSessions", session.sessionId))?.expireTime).toBeNull();
    vi.mocked(context.secrets.destroy).mockResolvedValue(undefined);
    await deleteFacebookUserConnections(context, "987");
    expect(await context.store.getConnectionsForUser(facebookUserHash(config, "987"))).toEqual([]);
  });

  it("compensates a secret created while deletion is waiting for its saving session", async () => {
    await authorize();
    vi.mocked(context.secrets.save).mockImplementationOnce(async () => {
      await expect(deleteFacebookUserConnections(context, "987")).rejects.toMatchObject({ code: "storage" });
      return `${config.secretName}/versions/1`;
    });
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toMatchObject({ code: "invalid" });
    expect(context.secrets.destroy).toHaveBeenCalledWith(`${config.secretName}/versions/1`);
    expect(await context.store.getConnectionsForUser(facebookUserHash(config, "987"))).toEqual([]);
    expect(await context.store.getSession(session.sessionId)).toMatchObject({ phase: "failed", userTokenCipher: null, connectionId: null });
  });

  it("retains a token-free intent when add-version outcome is unknown and refuses a completed receipt", async () => {
    await authorize();
    vi.mocked(context.secrets.save).mockRejectedValueOnce(new Error("unknown add-version outcome"));
    await expect(selectFacebookPage(context, session.cookieValue, selection())).rejects.toThrow("unknown add-version outcome");
    expect(await context.store.getSession(session.sessionId)).toMatchObject({
      phase: "failed", connectionId: session.sessionId, userTokenCipher: null, pages: [],
    });
    expect((await database.findOne("facebookOAuthSessions", session.sessionId))?.expireTime).toBeNull();
    const receipt = vi.spyOn(context.store, "createDeletionReceipt");
    await expect(deleteFacebookUserConnections(context, "987")).rejects.toMatchObject({ code: "storage" });
    expect(receipt).not.toHaveBeenCalled();
  });
});
