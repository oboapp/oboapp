import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFacebookSecretStore, FacebookSecretStoreError } from "./secret-store";

const sdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  add: vi.fn(),
  disable: vi.fn(),
  destroy: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    constructor(options?: unknown) {
      sdk.constructor(options);
    }
    addSecretVersion = sdk.add;
    disableSecretVersion = sdk.disable;
    destroySecretVersion = sdk.destroy;
    getSecretVersion = sdk.get;
  },
}));

const secretName = "projects/demo-project/secrets/facebook-page-tokens";
const version = `${secretName}/versions/7`;
const page = {
  connectionId: "connection-id", pageId: "101", accessToken: "synthetic-page-token", userHash: "user-hash", connectedAt: 1234,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", undefined);
  sdk.add.mockResolvedValue([{ name: version }]);
  sdk.disable.mockResolvedValue([{}]);
  sdk.destroy.mockResolvedValue([{}]);
  sdk.get.mockResolvedValue([{ state: 1 }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Facebook Secret Manager storage", () => {
  it("initializes lazily and stores a versioned token envelope in the configured secret", async () => {
    const store = createFacebookSecretStore({ secretName });
    expect(sdk.constructor).not.toHaveBeenCalled();
    expect(await store.save(page)).toBe(version);
    expect(sdk.constructor).toHaveBeenCalledWith(undefined);
    expect(sdk.add).toHaveBeenCalledWith({
      parent: secretName,
      payload: { data: Buffer.from(JSON.stringify({ kind: "facebook-page-token", version: 1, ...page }), "utf8") },
    }, { timeout: 10000, retry: null });
    await store.save({ ...page, pageId: "202" });
    expect(sdk.constructor).toHaveBeenCalledTimes(1);
    expect(sdk.add).toHaveBeenCalledTimes(2);
  });

  it("passes only service account email and key to the SDK", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", JSON.stringify({
      client_email: "synthetic@example.invalid",
      private_key: "synthetic-private-key",
      project_id: "not-forwarded",
      unexpected: "not-forwarded",
    }));
    await createFacebookSecretStore({ secretName }).save(page);
    expect(sdk.constructor).toHaveBeenCalledWith({ credentials: {
      client_email: "synthetic@example.invalid", private_key: "synthetic-private-key",
    } });
  });

  it("rejects malformed credentials with a controlled error", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "invalid-synthetic-private-key");
    const store = createFacebookSecretStore({ secretName });
    await expect(store.save(page)).rejects.toMatchObject({ code: "unavailable" });
    expect(sdk.constructor).not.toHaveBeenCalled();
  });

  it("rejects another secret and nonnumeric version aliases before initializing the SDK", async () => {
    const store = createFacebookSecretStore({ secretName });
    await expect(store.disable("projects/other/secrets/tokens/versions/7"))
      .rejects.toMatchObject({ code: "invalid_version" });
    await expect(store.destroy(`${secretName}/versions/latest`)).rejects.toMatchObject({ code: "invalid_version" });
    expect(sdk.constructor).not.toHaveBeenCalled();
  });

  it("disables and destroys only the exact stored version", async () => {
    const store = createFacebookSecretStore({ secretName });
    await store.disable(version);
    await store.destroy(version);
    expect(sdk.disable).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
    expect(sdk.destroy).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
  });

  it("confirms an already retired state before accepting a failed precondition", async () => {
    const store = createFacebookSecretStore({ secretName });
    sdk.disable.mockRejectedValue({ code: 9, message: "untrusted-provider-message" });
    sdk.destroy.mockRejectedValue({ code: 9 });
    sdk.get.mockResolvedValueOnce([{ state: "DISABLED" }]).mockResolvedValueOnce([{ state: "DESTROYED" }]);
    await expect(store.disable(version)).resolves.toBeUndefined();
    await expect(store.destroy(version)).resolves.toBeUndefined();
    expect(sdk.get).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
  });

  it("does not mistake an enabled or merely disabled version for destroyed credentials", async () => {
    const store = createFacebookSecretStore({ secretName });
    sdk.disable.mockRejectedValue({ code: 9, message: "pretend this is disabled" });
    sdk.destroy.mockRejectedValue({ code: 9, message: "pretend this is destroyed" });
    sdk.get.mockResolvedValueOnce([{ state: 1 }]).mockResolvedValueOnce([{ state: 2 }]);
    await expect(store.disable(version)).rejects.toMatchObject({ code: "unavailable" });
    await expect(store.destroy(version)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects token records before making a cloud request", async () => {
    const store = createFacebookSecretStore({ secretName });
    await expect(store.save({ ...page, accessToken: "invalid token" }))
      .rejects.toMatchObject({ code: "invalid_token_record" });
    expect(sdk.constructor).not.toHaveBeenCalled();
  });

  it("rejects an unexpected version reference returned by the provider", async () => {
    sdk.add.mockResolvedValue([{ name: "projects/other/secrets/tokens/versions/7" }]);
    await expect(createFacebookSecretStore({ secretName }).save(page))
      .rejects.toMatchObject({ code: "invalid_version" });
  });

  it("verifies a canonical project number through the configured project alias", async () => {
    const canonical = "projects/123456/secrets/facebook-page-tokens/versions/7";
    sdk.add.mockResolvedValue([{ name: canonical }]);
    sdk.get.mockResolvedValue([{ name: canonical, state: 1 }]);
    const store = createFacebookSecretStore({ secretName });
    expect(await store.save(page)).toBe(canonical);
    expect(sdk.get).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
    await store.destroy(canonical);
    expect(sdk.get).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).toHaveBeenCalledWith({ name: canonical }, { timeout: 10000, retry: null });
  });

  it("verifies a stored canonical version before a fresh instance retires it", async () => {
    const canonical = "projects/123456/secrets/facebook-page-tokens/versions/7";
    sdk.get.mockResolvedValue([{ name: canonical, state: 1 }]);
    await createFacebookSecretStore({ secretName }).disable(canonical);
    expect(sdk.get).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
    expect(sdk.disable).toHaveBeenCalledWith({ name: canonical }, { timeout: 10000, retry: null });
  });

  it("rejects a foreign numeric project without issuing a retirement request to it", async () => {
    sdk.get.mockResolvedValue([{ name: "projects/123456/secrets/facebook-page-tokens/versions/7", state: 1 }]);
    await expect(createFacebookSecretStore({ secretName }).destroy("projects/999999/secrets/facebook-page-tokens/versions/7"))
      .rejects.toMatchObject({ code: "invalid_version" });
    expect(sdk.get).toHaveBeenCalledWith({ name: version }, { timeout: 10000, retry: null });
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it("hides SDK error messages, token values, and causes", async () => {
    sdk.add.mockRejectedValue(new Error(`Provider refused ${page.accessToken}`));
    try {
      await createFacebookSecretStore({ secretName }).save(page);
      expect.fail("Expected credential storage failure");
    } catch (error) {
      expect(error).toBeInstanceOf(FacebookSecretStoreError);
      expect(String(error)).not.toContain(page.accessToken);
      expect(error).not.toHaveProperty("cause");
    }
  });
});
