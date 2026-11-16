import { cookies } from "next/headers";
import { FACEBOOK_SESSION_COOKIE } from "@/lib/facebook-connect/config";
import { facebookRedirect } from "@/lib/facebook-connect/http";
import {
  finishFacebookAuthorization,
  getFacebookConnectionContext,
} from "@/lib/facebook-connect/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getFacebookConnectionContext();
    const query = new URL(request.url).searchParams;
    const cookieStore = await cookies();
    await finishFacebookAuthorization(context, cookieStore.get(FACEBOOK_SESSION_COOKIE)?.value, {
      state: query.get("state"),
      code: query.get("code"),
      denied: query.has("error"),
    });
    return facebookRedirect(request);
  } catch (error) {
    return facebookRedirect(request, { error, clearCookie: true });
  }
}
