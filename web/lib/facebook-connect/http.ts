import { NextResponse } from "next/server";
import {
  FACEBOOK_SESSION_COOKIE,
  FACEBOOK_SESSION_DURATION_MS,
  getFacebookConnectConfig,
  type FacebookConnectConfig,
} from "./config";
import { FacebookConnectionFlowError, facebookFlowErrorCode } from "./service";

export const facebookPrivateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function facebookRedirect(
  request: Request,
  options: { error?: unknown; location?: string; cookieValue?: string; clearCookie?: boolean } = {},
): NextResponse {
  const config = getFacebookConnectConfig();
  const origin = config?.origin || new URL(request.url).origin;
  const destination = new URL(options.location || "/connect/facebook", origin);
  if (options.error) {
    destination.searchParams.set("error", facebookFlowErrorCode(options.error));
  }
  const response = NextResponse.redirect(destination, 303);
  for (const [name, value] of Object.entries(facebookPrivateHeaders)) {
    response.headers.set(name, value);
  }
  if (options.cookieValue || options.clearCookie) {
    response.cookies.set(FACEBOOK_SESSION_COOKIE, options.cookieValue || "", {
      httpOnly: true,
      secure: new URL(origin).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: options.clearCookie ? 0 : FACEBOOK_SESSION_DURATION_MS / 1000,
    });
  }
  return response;
}

export async function readFacebookForm(request: Request): Promise<URLSearchParams> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new FacebookConnectionFlowError("invalid");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 16384)) {
    throw new FacebookConnectionFlowError("invalid");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        size += chunk.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new FacebookConnectionFlowError("invalid");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const bytes = Buffer.concat(chunks, size);
    return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FacebookConnectionFlowError("invalid");
  }
}

export function requireFacebookSameOrigin(request: Request, config: FacebookConnectConfig): void {
  if (request.headers.get("origin") !== config.origin) {
    throw new FacebookConnectionFlowError("invalid");
  }
}
