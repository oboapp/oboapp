export const FACEBOOK_SESSION_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-obo-facebook-connect"
  : "obo-facebook-connect";
export const FACEBOOK_SESSION_DURATION_MS = 15 * 60 * 1000;

export interface FacebookConnectConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  origin: string;
  redirectUri: string;
  secretName: string;
  loginConfigId?: string;
}

export function getFacebookConnectConfig(
  env: NodeJS.ProcessEnv = process.env,
): FacebookConnectConfig | undefined {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  const apiVersion = env.FACEBOOK_GRAPH_API_VERSION;
  const secretName = env.FACEBOOK_PAGE_TOKENS_SECRET;
  const loginConfigId = env.FACEBOOK_LOGIN_CONFIG_ID;
  const baseUrl = env.FACEBOOK_CONNECT_BASE_URL || env.NEXT_PUBLIC_BASE_URL;

  if (
    !appId || !/^\d+$/.test(appId) ||
    !appSecret || appSecret.length < 16 || appSecret.length > 256 || /\s/.test(appSecret) ||
    !apiVersion || !/^v\d+\.\d+$/.test(apiVersion) ||
    !secretName || !/^projects\/[a-zA-Z0-9-]+\/secrets\/[a-zA-Z0-9_-]+$/.test(secretName) ||
    !baseUrl || (loginConfigId !== undefined && !/^\d+$/.test(loginConfigId))
  ) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    const localDevelopment = env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/"
    ) {
      return undefined;
    }

    return {
      appId,
      appSecret,
      apiVersion,
      origin: url.origin,
      redirectUri: new URL("/api/integrations/facebook/callback", url.origin).toString(),
      secretName,
      ...(loginConfigId ? { loginConfigId } : {}),
    };
  } catch {
    return undefined;
  }
}
