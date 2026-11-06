import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { FacebookConnectConfig } from "./config";

interface FacebookPageToken {
  connectionId: string;
  pageId: string;
  accessToken: string;
  userHash: string;
  connectedAt: number;
}

export class FacebookSecretStoreError extends Error {
  constructor(readonly code: "invalid_secret" | "invalid_version" | "invalid_token_record" | "unavailable") {
    super("Facebook credential storage failed");
    this.name = "FacebookSecretStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailedPrecondition(error: unknown): boolean {
  return isRecord(error) && error.code === 9;
}

async function operation<T>(perform: () => Promise<T>): Promise<T> {
  try {
    return await perform();
  } catch (error) {
    if (error instanceof FacebookSecretStoreError) {
      throw error;
    }
    throw new FacebookSecretStoreError("unavailable");
  }
}

/** Add token versions to one preprovisioned secret without creating secrets. */
export function createFacebookSecretStore(config: Pick<FacebookConnectConfig, "secretName">) {
  const secretName = config.secretName;
  if (!/^projects\/[A-Za-z0-9-]+\/secrets\/[A-Za-z0-9_-]+$/.test(secretName)) {
    throw new FacebookSecretStoreError("invalid_secret");
  }
  let clientPromise: Promise<SecretManagerServiceClient> | null = null;
  let canonicalSecretName = secretName;
  const secretId = secretName.slice(secretName.lastIndexOf("/") + 1);
  const requestOptions = { timeout: 10000, retry: null };

  function parseVersion(value: unknown): { name: string; secret: string; number: string } {
    if (typeof value !== "string") {
      throw new FacebookSecretStoreError("invalid_version");
    }
    const parts = /^projects\/([A-Za-z0-9-]+)\/secrets\/([A-Za-z0-9_-]+)\/versions\/([1-9]\d*)$/.exec(value);
    if (!parts || parts[2] !== secretId) {
      throw new FacebookSecretStoreError("invalid_version");
    }
    const secret = value.slice(0, value.lastIndexOf("/versions/"));
    if (secret !== secretName && secret !== canonicalSecretName && !/^\d+$/.test(parts[1])) {
      throw new FacebookSecretStoreError("invalid_version");
    }
    return { name: value, secret, number: parts[3] };
  }

  async function versionName(value: unknown, client: SecretManagerServiceClient): Promise<string> {
    const candidate = parseVersion(value);
    if (candidate.secret !== secretName && candidate.secret !== canonicalSecretName) {
      const [confirmed] = await client.getSecretVersion({
        name: `${secretName}/versions/${candidate.number}`,
      }, requestOptions);
      if (confirmed.name !== candidate.name) {
        throw new FacebookSecretStoreError("invalid_version");
      }
      canonicalSecretName = candidate.secret;
    }
    return candidate.name;
  }

  function getClient(): Promise<SecretManagerServiceClient> {
    clientPromise ??= operation(async () => {
      const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (!raw) {
        return new SecretManagerServiceClient();
      }
      const account: unknown = JSON.parse(raw);
      if (!isRecord(account) || typeof account.client_email !== "string" || !account.client_email ||
          typeof account.private_key !== "string" || !account.private_key) {
        throw new FacebookSecretStoreError("unavailable");
      }
      return new SecretManagerServiceClient({
        credentials: { client_email: account.client_email, private_key: account.private_key },
      });
    });
    return clientPromise;
  }

  async function retire(value: string, destroy: boolean): Promise<void> {
    parseVersion(value);
    await operation(async () => {
      const client = await getClient();
      const name = await versionName(value, client);
      try {
        if (destroy) {
          await client.destroySecretVersion({ name }, requestOptions);
        } else {
          await client.disableSecretVersion({ name }, requestOptions);
        }
      } catch (error) {
        if (!isFailedPrecondition(error)) {
          throw new FacebookSecretStoreError("unavailable");
        }
        const [version] = await client.getSecretVersion({ name }, requestOptions);
        const destroyed = version.state === 3 || version.state === "DESTROYED";
        const disabled = version.state === 2 || version.state === "DISABLED";
        if (!destroyed && (destroy || !disabled)) {
          throw new FacebookSecretStoreError("unavailable");
        }
      }
    });
  }

  return {
    async save(page: FacebookPageToken): Promise<string> {
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(page.connectionId) ||
          !/^[1-9]\d{0,31}$/.test(page.pageId) || typeof page.accessToken !== "string" ||
          !page.accessToken || page.accessToken.length > 8192 || /\s/.test(page.accessToken) ||
          typeof page.userHash !== "string" || !page.userHash || page.userHash.length > 256 ||
          !Number.isSafeInteger(page.connectedAt) || page.connectedAt < 0) {
        throw new FacebookSecretStoreError("invalid_token_record");
      }
      return operation(async () => {
        const client = await getClient();
        const [version] = await client.addSecretVersion({
          parent: secretName,
          payload: { data: Buffer.from(JSON.stringify({
            kind: "facebook-page-token",
            version: 1,
            connectionId: page.connectionId,
            pageId: page.pageId,
            accessToken: page.accessToken,
            userHash: page.userHash,
            connectedAt: page.connectedAt,
          }), "utf8") },
        }, requestOptions);
        return versionName(version.name, client);
      });
    },
    async disable(version: string): Promise<void> {
      await retire(version, false);
    },
    async destroy(version: string): Promise<void> {
      await retire(version, true);
    },
  };
}

export type FacebookSecretStore = ReturnType<typeof createFacebookSecretStore>;
